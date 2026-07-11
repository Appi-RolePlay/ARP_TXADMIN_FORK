const modulename = 'ArpCrashReport';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { embedColors } from './discordHelpers';
import { msToShortestDuration } from '@lib/misc';
import got from '@lib/got';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

/**
 * ARP patch: when the monitor restarts the server (process died or hung), report it to Discord
 * through the EXISTING bot integration — same bot, same channel as the other txAdmin warnings
 * (Settings -> Discord -> Warnings Channel). No-op when the bot is disabled/not configured, so
 * this fork behaves exactly like vanilla txAdmin until the integration is set up in the panel.
 *
 * FiveM has no clean crash API on Linux: a native crash (mono SIGSEGV/SIGABRT — e.g. bad interop,
 * a runtime bug, or unmanaged corruption) dumps ONE big block to stderr, in this order:
 *
 *     Stacktrace:                                   <- managed frames (the C# that crashed)
 *     Native stacktrace:                            <- native backtrace, rendered by gdb
 *     Debug info from gdb:                          <-   (gdb is shipped in our fxserver image)
 *     /proc/self/maps:                              <- hundreds of KB of memory map — noise
 *     Memory around native instruction pointer ...  <- hex dump — noise
 *     ===== Got a SIGSEGV while executing ... =====  <- banner that marks the crash
 *
 * The USEFUL part (managed + native backtrace) sits at the TOP; the noise (maps + hex) is bigger
 * than any tail slice. So we don't slice blindly — we locate the block by its banner, keep from
 * `Stacktrace:` down, and cut the two noise sections out. What's left is exactly the two stacks.
 */

//Fallback console tail for the HANG case (bootTimeout/healthCheck/heartBeat): no native dump exists,
//so we just ship the recent console so there's still context.
const CONSOLE_TAIL_BYTES = 16 * 1024;

//How long to wait for the crash dump to finish draining into the console buffer. The close is
//detected by a status poll that can fire a beat before the last stderr chunk lands, so without this
//the report is sometimes empty. Safe to wait: the restarted process won't emit for several seconds.
const DRAIN_RETRY_MS = 250;
const DRAIN_RETRIES = 12; // ~3s max

//Markers mono prints — matched as substrings so txAdmin's console prefixes don't break them.
const CRASH_MARKER = 'while executing native code'; // inside the "Got a SIG* ..." banner
const STACK_START = 'Stacktrace:';
const NATIVE_START = 'Native stacktrace:';
const MAPS_HEADER = '/proc/self/maps:';
const MEM_HEADER = 'Memory around native instruction pointer';

//Optional GIF shown at the bottom of the crash embed. We fetch it SERVER-SIDE and re-upload it to
//Discord as a real attachment instead of handing Discord the URL — that way Discord never has to
//reach the host, so the image always renders. Must be a direct .gif URL, not a tenor.com/view page.
const CRASH_GIF_URL = 'https://media1.tenor.com/m/iVVi-enilPAAAAAC/sound-the-car-alarm-cat.gif';

//Same stripping the logger applies for files, plus the live-console time markers ({§68eb1a2c}).
const regexColors = /\x1B[^m]*?m/g;
const regexControls = /[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]|(?:\x1B\[|\x9B)[\d;]+[@-K]/g;
const regexTimeMarkers = /\{§[0-9a-f]+\}/g;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanBuffer = () => txCore.logger.fxserver.getRecentBuffer()
    .replace(regexTimeMarkers, '')
    .replace(regexControls, '')
    .replace(regexColors, '');

/**
 * Pull the crash block out of the console buffer and drop the maps/hex noise.
 * Returns null when there's no native crash dump (e.g. a hang, or a clean close).
 */
const extractCrashBlock = (buf: string): string | null => {
    const bannerIdx = buf.lastIndexOf(CRASH_MARKER);
    if (bannerIdx === -1) return null;

    //Start of the dump: the managed "Stacktrace:" above the banner, else the native one, else a
    //bounded window back (some builds omit the managed stack).
    let start = buf.lastIndexOf(STACK_START, bannerIdx);
    if (start === -1) start = buf.lastIndexOf(NATIVE_START, bannerIdx);
    if (start === -1) start = Math.max(0, bannerIdx - 8 * 1024);

    //End of the dump: the closing "=====" line just after the banner text.
    const afterBanner = buf.indexOf('====', bannerIdx);
    const end = afterBanner === -1 ? buf.length : (buf.indexOf('\n', afterBanner) + 1 || buf.length);

    let block = buf.slice(start, end);
    //Cut /proc/self/maps ... up to the memory dump (or the banner if memory section is absent).
    block = block.replace(
        /\/proc\/self\/maps:[\s\S]*?(?=Memory around native instruction pointer|={5,})/i,
        '[/proc/self/maps omitted]\n\n',
    );
    //Cut the hex "Memory around ..." dump up to the banner.
    block = block.replace(
        /Memory around native instruction pointer[\s\S]*?(?=={5,})/i,
        '[memory dump omitted]\n\n',
    );
    return block.trim();
};

//Fence content for the embed without letting a stray ``` break the code block.
const fenced = (text: string, max: number) => {
    const body = text.length > max ? text.slice(0, max) + '\n…(truncated — see attachment)' : text;
    return '```\n' + body.replace(/```/g, 'ʼʼʼ') + '\n```';
};

export const sendArpCrashReport = (cause: string, reason: string) => {
    if (!txConfig.discordBot.enabled || !txConfig.discordBot.warningsChannel) return;
    const channel = txCore.discordBot.announceChannel;
    if (!channel) {
        console.verbose.warn('bot not ready, crash report dropped');
        return;
    }

    const uptimeMs = txCore.fxRunner.child?.uptime;

    //Fire-and-forget: never block the monitor's restart. The buffer keeps the crash dump until new
    //output pushes it out (seconds away), so waiting a few hundred ms here is safe.
    void (async () => {
        try {
            //Wait for the native dump to finish draining (only relevant for a process close).
            let buf = cleanBuffer();
            if (cause === 'close') {
                for (let i = 0; i < DRAIN_RETRIES && buf.lastIndexOf(CRASH_MARKER) === -1; i++) {
                    await delay(DRAIN_RETRY_MS);
                    buf = cleanBuffer();
                }
            }

            const crashBlock = cause === 'close' ? extractCrashBlock(buf) : null;

            const embed = new EmbedBuilder({
                title: cause === 'close'
                    ? '💥 Server crashed — restarting'
                    : '⚠️ Server unresponsive — force-restarting',
                fields: [
                    { name: 'Reason', value: reason.slice(0, 1000), inline: false },
                    { name: 'Cause', value: cause, inline: true },
                    { name: 'Uptime', value: uptimeMs ? msToShortestDuration(uptimeMs) : 'unknown', inline: true },
                ],
                footer: { text: txConfig.general.serverName },
            }).setColor(embedColors.danger).setTimestamp();

            const files: AttachmentBuilder[] = [];
            if (crashBlock) {
                //Managed + native backtrace, no maps/hex noise. Inline in the embed for a glance,
                //full block attached for the details.
                embed.setDescription(fenced(crashBlock, 3500));
                files.push(new AttachmentBuilder(
                    Buffer.from(crashBlock, 'utf8'),
                    { name: 'crash.txt', description: 'Managed + native backtrace (maps/hex stripped)' },
                ));
            } else {
                //No native dump (hang or clean close) — ship the recent console for context.
                const tail = buf.slice(-CONSOLE_TAIL_BYTES);
                embed.setDescription(cause === 'close'
                    ? '_No native crash dump was captured — the process may have been killed (OOM/SIGKILL). Recent console attached._'
                    : '_Server hung (no crash dump). Recent console attached._');
                files.push(new AttachmentBuilder(
                    Buffer.from(tail, 'utf8'),
                    { name: 'console-tail.txt', description: 'Last server console output before the restart' },
                ));
            }

            if (CRASH_GIF_URL) {
                try {
                    const gif = await got(CRASH_GIF_URL, { responseType: 'buffer', timeout: { request: 5000 } });
                    files.push(new AttachmentBuilder(gif.body as Buffer, { name: 'alert.gif' }));
                    embed.setImage('attachment://alert.gif');
                } catch (error) {
                    console.warn(`Crash gif fetch failed, sending without it: ${(error as Error).message}`);
                }
            }

            await channel.send({ embeds: [embed], files });
        } catch (error) {
            console.error(`Failed to send crash report to Discord: ${(error as Error).message}`);
        }
    })();
};

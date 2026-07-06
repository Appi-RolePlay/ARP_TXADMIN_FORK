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
 */

const CONSOLE_TAIL_BYTES = 48 * 1024;

//Optional GIF shown at the bottom of the crash embed. We fetch it SERVER-SIDE and re-upload it to
//Discord as a real attachment (see below) instead of handing Discord the URL — that way Discord
//never has to reach the host itself, so the image always renders regardless of proxy/host quirks.
//Must be a direct image file URL (a real .gif), NOT a tenor.com/view HTML page. Empty -> no image.
const CRASH_GIF_URL = 'https://media1.tenor.com/m/iVVi-enilPAAAAAC/sound-the-car-alarm-cat.gif';

//Same stripping the logger applies for files, plus the live-console time markers ({§68eb1a2c})
const regexColors = /\x1B[^m]*?m/g;
const regexControls = /[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]|(?:\x1B\[|\x9B)[\d;]+[@-K]/g;
const regexTimeMarkers = /\{§[0-9a-f]+\}/g;

export const sendArpCrashReport = (cause: string, reason: string) => {
    if (!txConfig.discordBot.enabled || !txConfig.discordBot.warningsChannel) return;
    const channel = txCore.discordBot.announceChannel;
    if (!channel) {
        console.verbose.warn('bot not ready, crash report dropped');
        return;
    }
    try {
        const uptimeMs = txCore.fxRunner.child?.uptime;
        const consoleTail = txCore.logger.fxserver.getRecentBuffer()
            .slice(-CONSOLE_TAIL_BYTES)
            .replace(regexTimeMarkers, '')
            .replace(regexControls, '')
            .replace(regexColors, '');
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
        const files: AttachmentBuilder[] = [
            new AttachmentBuilder(
                Buffer.from(consoleTail, 'utf8'),
                { name: 'console-tail.txt', description: 'Last server console output before the crash' },
            ),
        ];

        //Console is captured synchronously above (before restart); the gif fetch + send is async and
        //fire-and-forget. Re-uploading the gif ourselves guarantees it renders in the embed.
        void (async () => {
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
        })().catch((error: Error) => {
            console.error(`Failed to send crash report to Discord: ${error.message}`);
        });
    } catch (error) {
        console.error(`Failed to assemble crash report: ${(error as Error).message}`);
    }
};

const modulename = 'ArpCrashReport';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { embedColors } from './discordHelpers';
import { msToShortestDuration } from '@lib/misc';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

/**
 * ARP patch: when the monitor restarts the server (process died or hung), report it to Discord
 * through the EXISTING bot integration — same bot, same channel as the other txAdmin warnings
 * (Settings -> Discord -> Warnings Channel). No-op when the bot is disabled/not configured, so
 * this fork behaves exactly like vanilla txAdmin until the integration is set up in the panel.
 */

const CONSOLE_TAIL_BYTES = 48 * 1024;

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
        const attachment = new AttachmentBuilder(
            Buffer.from(consoleTail, 'utf8'),
            { name: 'console-tail.txt', description: 'Last server console output before the crash' },
        );
        channel.send({ embeds: [embed], files: [attachment] }).catch((error: Error) => {
            console.error(`Failed to send crash report to Discord: ${error.message}`);
        });
    } catch (error) {
        console.error(`Failed to assemble crash report: ${(error as Error).message}`);
    }
};

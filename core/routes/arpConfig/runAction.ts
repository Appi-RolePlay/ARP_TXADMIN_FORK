const modulename = 'WebServer:RunArpAction';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import { DB_CFG } from '@modules/ArpDb';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { GenericApiErrorResp } from '@shared/genericApiTypes';
import type { RunArpActionSuccessResp } from '@shared/arpConfigTypes';
const console = consoleFactory(modulename);

export type RunArpActionResp = RunArpActionSuccessResp | GenericApiErrorResp;

//The command runs asynchronously on the game server and reports back through the DB.
const POLL_INTERVAL_MS = 200;
const POLL_ATTEMPTS = 25;

const nonEmpty = z.string().trim().min(1);

/**
 * Which commands the page may run. This is a routing table, NOT validation: whether a value is
 * legal for a key, whether a column may be written, whether an artifact may be activated — all of
 * that is decided by the game server, which owns those rules and would otherwise have a second,
 * drifting implementation living here.
 */
const bodySchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('keys.set'), key: nonEmpty, value: z.string().min(1) }),
    z.object({ action: z.literal('keys.unset'), key: nonEmpty }),
    z.object({ action: z.literal('keys.publish'), comment: nonEmpty }),
    z.object({ action: z.literal('keys.activate'), artifactId: z.number().int().positive() }),
    z.object({ action: z.literal('keys.rollback') }),
    z.object({ action: z.literal('rows.setVehInfo'), displayName: nonEmpty, column: nonEmpty, value: z.string().min(1) }),
    z.object({ action: z.literal('rows.setItemTpl'), id: z.number().int(), column: nonEmpty, value: z.string().min(1) }),
    z.object({ action: z.literal('rows.setCarStock'), displayName: nonEmpty, value: z.string().min(1) }),
]);

type ActionBody = z.infer<typeof bodySchema>;

/**
 * Base64 keeps free text intact across the console. txAdmin's argument stringifier rewrites `;` to
 * a lookalike and mis-escapes quotes when a payload has an odd number of them — which JSON values
 * and admin comments routinely do. The server reads it back through `--b64`.
 */
const encodePayload = (value: string) => Buffer.from(value, 'utf8').toString('base64');

/** Builds the console argument list; the free-text part always travels as --b64. */
const buildArgs = (body: ActionBody): string[] => {
    switch (body.action) {
        case 'keys.set':
            return ['keys', 'set', body.key, '--b64', encodePayload(body.value)];
        case 'keys.unset':
            return ['keys', 'unset', body.key];
        case 'keys.publish':
            return ['keys', 'publish', '--b64', encodePayload(body.comment)];
        case 'keys.activate':
            return ['keys', 'activate', String(body.artifactId)];
        case 'keys.rollback':
            return ['keys', 'rollback'];
        case 'rows.setVehInfo':
            return ['rows', 'set', 'vehinfo', body.displayName, body.column, '--b64', encodePayload(body.value)];
        case 'rows.setItemTpl':
            return ['rows', 'set', 'itemtpl', String(body.id), body.column, '--b64', encodePayload(body.value)];
        case 'rows.setCarStock':
            return ['rows', 'set', 'carstock', body.displayName, '--b64', encodePayload(body.value)];
    }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type OpRow = { status: string; message: string; command: string };

/**
 * Runs one `arp_cfg` command on the game server and returns what the server made of it.
 *
 * The console is a one-way pipe — `sendCommand` only reports whether the write to stdin
 * succeeded — so the request carries an `--op <uuid>` that the server writes its outcome under,
 * and this handler polls for that row. That is the whole reason config_ops exists: without it a
 * rejected value would look exactly like an applied one.
 */
export default async function RunArpAction(ctx: AuthedCtx) {
    const sendTypedResp = (data: RunArpActionResp) => ctx.send(data);

    //Check permissions
    if (!ctx.admin.testPermission('arp.config', modulename)) {
        return sendTypedResp({
            error: 'You do not have permission to change the game config.',
        });
    }

    //Validating input
    const schemaRes = bodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return sendTypedResp({
            error: `Invalid request body: ${schemaRes.error.message}`,
        });
    }
    const body = schemaRes.data;

    //Ignore commands when the server is offline
    if (!txCore.fxRunner.child?.isAlive) {
        return sendTypedResp({
            error: 'The server is not running, so the config command cannot be applied.',
        });
    }

    const opId = randomUUID();
    const args = [...buildArgs(body), '--by', ctx.admin.name, '--op', opId];

    const sent = txCore.fxRunner.sendCommand('arp_cfg', args, ctx.admin.name);
    if (!sent) {
        return sendTypedResp({
            error: 'Could not write the command to the server console.',
        });
    }

    //Poll for the result row the server writes when the action finishes
    try {
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
            await sleep(POLL_INTERVAL_MS);
            const row = await txCore.arpDb.queryFirst<OpRow>(
                `SELECT status, message, command FROM ${DB_CFG}.config_ops WHERE op_id = ?`,
                [opId]
            );
            if (row) {
                return sendTypedResp({
                    status: row.status === 'ok' ? 'ok' : 'error',
                    message: row.message,
                    command: row.command,
                });
            }
        }
    } catch (error) {
        console.verbose.dir(error);
        return sendTypedResp({
            error: `The command was sent, but its result could not be read: ${(error as Error).message}`,
        });
    }

    return sendTypedResp({
        error: 'The command was sent, but the server did not report a result in time.'
            + ' Check the Live Console before retrying.',
    });
};

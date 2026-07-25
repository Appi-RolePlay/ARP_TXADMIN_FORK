const modulename = 'WebServer:GetArpRows';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import { DB_CFG, DB_STATE } from '@modules/ArpDb';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { GenericApiErrorResp } from '@shared/genericApiTypes';
import type {
    ArpCarStockRow, ArpItemTplRow, ArpVehInfoRow, GetArpRowsSuccessResp,
} from '@shared/arpConfigTypes';
const console = consoleFactory(modulename);

export type GetArpRowsResp = GetArpRowsSuccessResp | GenericApiErrorResp;

/** A search box, not an export: enough rows to pick from, few enough to render. */
const ROW_LIMIT = 50;

const querySchema = z.object({
    target: z.enum(['vehinfo', 'itemtpl', 'carstock']),
    q: z.string().max(128).optional(),
});

/** Escapes the LIKE wildcards so a search for "100%" does not match everything. */
const likeTerm = (term: string) => `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

/**
 * Searches the hand-edited definition tables, returning only the columns the server's
 * `arp_cfg rows` command is willing to write. Anything else is not editable here, so showing it
 * would only invite a request we would have to refuse.
 */
export default async function GetArpRows(ctx: AuthedCtx) {
    const sendTypedResp = (data: GetArpRowsResp) => ctx.send(data);

    //Check permissions
    if (!ctx.admin.testPermission('arp.config', modulename)) {
        return sendTypedResp({
            error: 'You do not have permission to view the game config.',
        });
    }

    //Validating input
    const schemaRes = querySchema.safeParse(ctx.request.query);
    if (!schemaRes.success) {
        return sendTypedResp({
            error: `Invalid request: ${schemaRes.error.message}`,
        });
    }
    const { target } = schemaRes.data;
    const search = schemaRes.data.q?.trim() ?? '';

    try {
        const serverOnline = !!txCore.fxRunner.child?.isAlive;

        if (target === 'vehinfo') {
            const rows = await txCore.arpDb.query<any>(
                `SELECT id, display_name, price, price_dc, trunk_capacity
                 FROM ${DB_CFG}.vehicle_models
                 WHERE ? = '' OR display_name LIKE ?
                 ORDER BY display_name ASC LIMIT ${ROW_LIMIT + 1}`,
                [search, likeTerm(search)]
            );
            const truncated = rows.length > ROW_LIMIT;
            const vehinfo: ArpVehInfoRow[] = rows.slice(0, ROW_LIMIT).map((r) => ({
                id: r.id,
                displayName: r.display_name,
                //decimal(18,2) — kept as text so no cent is lost on the way to the input
                price: String(r.price),
                priceDc: r.price_dc,
                trunkCapacity: r.trunk_capacity,
            }));
            return sendTypedResp({ target, vehinfo, truncated, serverOnline });
        }

        if (target === 'itemtpl') {
            const asId = /^\d+$/.test(search) ? parseInt(search, 10) : -1;
            const rows = await txCore.arpDb.query<any>(
                `SELECT id, name, label, price, max_stack, weight, volume
                 FROM ${DB_CFG}.item_templates
                 WHERE ? = '' OR id = ? OR name LIKE ? OR label LIKE ?
                 ORDER BY id ASC LIMIT ${ROW_LIMIT + 1}`,
                [search, asId, likeTerm(search), likeTerm(search)]
            );
            const truncated = rows.length > ROW_LIMIT;
            const itemtpl: ArpItemTplRow[] = rows.slice(0, ROW_LIMIT).map((r) => ({
                id: r.id,
                name: r.name,
                label: r.label,
                price: r.price,
                maxStack: r.max_stack,
                weight: Number(r.weight),
                volume: r.volume,
            }));
            return sendTypedResp({ target, itemtpl, truncated, serverOnline });
        }

        //carstock: the dealership cap next to how much of it is already taken.
        //cars.name joins vehicle_models.display_name by string — there is no id link (M0017).
        const rows = await txCore.arpDb.query<any>(
            `SELECT v.display_name, v.max_count,
                    (SELECT COUNT(*) FROM ${DB_STATE}.cars c WHERE c.name = v.display_name) AS owned
             FROM ${DB_CFG}.vehicle_models v
             WHERE ? = '' OR v.display_name LIKE ?
             ORDER BY v.display_name ASC LIMIT ${ROW_LIMIT + 1}`,
            [search, likeTerm(search)]
        );
        const truncated = rows.length > ROW_LIMIT;
        const carstock: ArpCarStockRow[] = rows.slice(0, ROW_LIMIT).map((r) => {
            const owned = Number(r.owned);
            return {
                displayName: r.display_name,
                maxCount: r.max_count,
                owned,
                available: Math.max(0, r.max_count - owned),
            };
        });
        return sendTypedResp({ target, carstock, truncated, serverOnline });
    } catch (error) {
        console.verbose.dir(error);
        return sendTypedResp({
            error: `Could not read the ARP config database: ${(error as Error).message}`,
        });
    }
};

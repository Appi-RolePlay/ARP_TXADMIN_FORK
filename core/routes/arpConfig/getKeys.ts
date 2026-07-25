const modulename = 'WebServer:GetArpKeys';
import consoleFactory from '@lib/console';
import { DB_CFG } from '@modules/ArpDb';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { GenericApiErrorResp } from '@shared/genericApiTypes';
import type { ArpConfigArtifact, ArpConfigKeyRow, GetArpKeysSuccessResp } from '@shared/arpConfigTypes';
const console = consoleFactory(modulename);

export type GetArpKeysResp = GetArpKeysSuccessResp | GenericApiErrorResp;

/** History is a review aid, not an archive — the panel shows the recent tail. */
const ARTIFACT_HISTORY_LIMIT = 50;

type RegistryRow = {
    cfg_key: string;
    kind: string;
    default_json: string;
    description: string;
    client_visible: number;
};

type DraftRow = {
    cfg_key: string;
    cfg_value: string;
    updated_by: string;
    updated_at: Date | string;
};

type ArtifactRow = {
    id: number;
    sha: string;
    author: string;
    comment: string;
    created_at: Date | string;
    data?: string;
};

type StateRow = {
    active_artifact_id: number | null;
    activated_at: Date | string | null;
    activated_by: string;
};

const asIso = (value: Date | string | null) => {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};

/**
 * Assembles the read model of the runtime-config level: the key registry the running server
 * mirrored into the DB, overlaid with the active artifact, annotated with pending draft edits, plus
 * the artifact history.
 *
 * The overlay is applied here only to DISPLAY what the server resolves — the server itself remains
 * the only thing that computes, validates and activates values.
 */
export default async function GetArpKeys(ctx: AuthedCtx) {
    const sendTypedResp = (data: GetArpKeysResp) => ctx.send(data);

    //Check permissions
    if (!ctx.admin.testPermission('arp.config', modulename)) {
        return sendTypedResp({
            error: 'You do not have permission to view the game config.',
        });
    }

    try {
        const [registry, drafts, state, artifacts] = await Promise.all([
            txCore.arpDb.query<RegistryRow>(
                `SELECT cfg_key, kind, default_json, description, client_visible
                 FROM ${DB_CFG}.config_registry ORDER BY cfg_key ASC`
            ),
            txCore.arpDb.query<DraftRow>(
                `SELECT cfg_key, cfg_value, updated_by, updated_at FROM ${DB_CFG}.config_drafts`
            ),
            txCore.arpDb.queryFirst<StateRow>(
                `SELECT active_artifact_id, activated_at, activated_by FROM ${DB_CFG}.config_state WHERE id = 1`
            ),
            txCore.arpDb.query<ArtifactRow>(
                `SELECT id, sha, author, comment, created_at, data FROM ${DB_CFG}.config_artifacts
                 ORDER BY id DESC LIMIT ${ARTIFACT_HISTORY_LIMIT}`
            ),
        ]);

        const activeArtifactId = state?.active_artifact_id ?? null;

        //The active artifact holds a full snapshot of every explicitly-set key
        let overlay: Record<string, unknown> = {};
        if (activeArtifactId !== null) {
            const active = artifacts.find((a) => a.id === activeArtifactId)
                ?? await txCore.arpDb.queryFirst<ArtifactRow>(
                    `SELECT id, sha, author, comment, created_at, data FROM ${DB_CFG}.config_artifacts WHERE id = ?`,
                    [activeArtifactId]
                );
            if (active?.data) {
                try {
                    overlay = JSON.parse(active.data);
                } catch (error) {
                    console.warn(`Active artifact #${activeArtifactId} has unparseable data.`);
                }
            }
        }

        const draftByKey = new Map(drafts.map((d) => [d.cfg_key, d]));

        const keys: ArpConfigKeyRow[] = registry.map((row) => {
            const hasOverlay = Object.prototype.hasOwnProperty.call(overlay, row.cfg_key);
            const activeJson = hasOverlay ? JSON.stringify(overlay[row.cfg_key]) : null;
            const draft = draftByKey.get(row.cfg_key);
            return {
                key: row.cfg_key,
                kind: row.kind,
                description: row.description,
                clientVisible: !!row.client_visible,
                defaultJson: row.default_json,
                activeJson,
                effectiveJson: activeJson ?? row.default_json,
                draftJson: draft?.cfg_value ?? null,
                draftBy: draft?.updated_by ?? null,
                draftAt: draft ? asIso(draft.updated_at) : null,
            };
        });

        const history: ArpConfigArtifact[] = artifacts.map((row) => {
            let keyCount = 0;
            try {
                keyCount = Object.keys(JSON.parse(row.data ?? '{}')).length;
            } catch (error) {
                keyCount = 0;
            }
            return {
                id: row.id,
                sha: row.sha,
                author: row.author,
                comment: row.comment,
                createdAt: asIso(row.created_at) ?? '',
                isActive: row.id === activeArtifactId,
                keyCount,
            };
        });

        return sendTypedResp({
            keys,
            artifacts: history,
            activeArtifactId,
            activatedAt: asIso(state?.activated_at ?? null),
            activatedBy: state?.activated_by ?? null,
            draftCount: drafts.length,
            serverOnline: !!txCore.fxRunner.child?.isAlive,
        });
    } catch (error) {
        console.verbose.dir(error);
        return sendTypedResp({
            error: `Could not read the ARP config database: ${(error as Error).message}`,
        });
    }
};

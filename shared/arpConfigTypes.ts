/**
 * Types for the ARP game-config page.
 *
 * The panel reads state straight out of the gamemode's database and mutates it only by asking the
 * game server to run its own `arp_cfg` console command, so these types describe two different
 * things: a read model assembled in the route from SQL, and the request/result envelope of a
 * command run.
 */

export type ArpConfigKeyRow = {
    key: string;
    /** RuntimeConfigKind: Int | Decimal | Bool | String | Json */
    kind: string;
    description: string;
    clientVisible: boolean;
    /** Compiled fallback, JSON-encoded. */
    defaultJson: string;
    /** Value from the active artifact, or null when the key falls back to the default. */
    activeJson: string | null;
    /** What the server resolves today: the artifact value if any, else the default. */
    effectiveJson: string;
    /** Pending draft value, staged but neither published nor activated. */
    draftJson: string | null;
    draftBy: string | null;
    draftAt: string | null;
};

export type ArpConfigArtifact = {
    id: number;
    sha: string;
    author: string;
    comment: string;
    createdAt: string;
    isActive: boolean;
    /** Number of explicitly-set keys in the snapshot. */
    keyCount: number;
};

export type GetArpKeysSuccessResp = {
    keys: ArpConfigKeyRow[];
    artifacts: ArpConfigArtifact[];
    activeArtifactId: number | null;
    activatedAt: string | null;
    activatedBy: string | null;
    draftCount: number;
    /** False when the fxserver is down — every mutating action would be refused. */
    serverOnline: boolean;
};

export type ArpVehInfoRow = {
    id: number;
    displayName: string;
    price: string;
    priceDc: number;
    trunkCapacity: number;
};

export type ArpItemTplRow = {
    id: number;
    name: string;
    label: string;
    price: number;
    maxStack: number;
    weight: number;
    volume: number;
};

export type ArpCarStockRow = {
    displayName: string;
    maxCount: number;
    owned: number;
    available: number;
};

export type ArpRowsTarget = 'vehinfo' | 'itemtpl' | 'carstock';

export type GetArpRowsSuccessResp = {
    target: ArpRowsTarget;
    vehinfo?: ArpVehInfoRow[];
    itemtpl?: ArpItemTplRow[];
    carstock?: ArpCarStockRow[];
    /** True when the result was cut at the row limit. */
    truncated: boolean;
    serverOnline: boolean;
};

export type ArpConfigAction =
    | { action: 'keys.set'; key: string; value: string }
    | { action: 'keys.unset'; key: string }
    | { action: 'keys.publish'; comment: string }
    | { action: 'keys.activate'; artifactId: number }
    | { action: 'keys.rollback' }
    | { action: 'rows.setVehInfo'; displayName: string; column: string; value: string }
    | { action: 'rows.setItemTpl'; id: number; column: string; value: string }
    | { action: 'rows.setCarStock'; displayName: string; value: string };

export type RunArpActionReq = ArpConfigAction;

export type RunArpActionSuccessResp = {
    /** Outcome as reported by the game server itself. */
    status: 'ok' | 'error';
    message: string;
    /** The command as the server saw it, for the console trail. */
    command: string;
};

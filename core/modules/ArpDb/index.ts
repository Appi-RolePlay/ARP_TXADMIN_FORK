const modulename = 'ArpDb';
import mysql from 'mysql2/promise';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);


/**
 * Read-only access to the ARP gamemode's MySQL databases.
 *
 * The game config page needs to SHOW what the gamemode has stored (registry, drafts, artifacts,
 * def-table rows), but it must never CHANGE any of it from here: every mutation goes through the
 * server's own `arp_cfg` console command, which owns validation, the atomic swap, the client push
 * and the audit trail. Two implementations of those rules would drift, so this module issues
 * SELECTs and nothing else.
 *
 * The connection string is the same one the game server reads from ARP_MYSQL_CONNECTION — txAdmin
 * runs in the environment that provides it — in .NET form (`Server=...;Port=...;Database=...`),
 * which is parsed here into mysql2 options. txConfig.arp.mysqlConnection overrides it when set.
 */

/** Database names, as created by the migration chain (M0012 split). */
export const DB_CFG = 'arp_cfg';
export const DB_STATE = 'arp_state';

const CONNECTION_ENV_VAR = 'ARP_MYSQL_CONNECTION';

type ParsedConnection = {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
};

/**
 * Parses a .NET/MySqlConnector connection string. Keys are case- and space-insensitive, and the
 * common aliases are accepted because the repo's scripts and docs use both spellings.
 */
export const parseDotNetConnectionString = (raw: string): ParsedConnection | string => {
    const values = new Map<string, string>();
    for (const pair of raw.split(';')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const key = pair.slice(0, eq).trim().toLowerCase().replaceAll(' ', '');
        const value = pair.slice(eq + 1).trim();
        if (key) values.set(key, value);
    }

    const pick = (...keys: string[]) => {
        for (const key of keys) {
            const value = values.get(key);
            if (value !== undefined && value !== '') return value;
        }
        return undefined;
    };

    const host = pick('server', 'host', 'datasource', 'address', 'addr');
    const database = pick('database', 'initialcatalog');
    const user = pick('userid', 'user', 'uid', 'username');
    const password = pick('password', 'pwd') ?? '';
    const portRaw = pick('port') ?? '3306';
    const port = parseInt(portRaw, 10);

    if (!host) return `missing 'Server' in the connection string`;
    if (!database) return `missing 'Database' in the connection string`;
    if (!user) return `missing 'User Id' in the connection string`;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return `invalid 'Port' value '${portRaw}'`;

    return { host, port, database, user, password };
};


export default class ArpDb {
    private pool: mysql.Pool | null = null;
    private poolSource: string | null = null;

    /** The configured connection string, config first, then the environment. */
    private getConnectionString(): string | null {
        const fromConfig = txConfig.arp?.mysqlConnection;
        if (typeof fromConfig === 'string' && fromConfig.length) return fromConfig;
        const fromEnv = process.env[CONNECTION_ENV_VAR];
        if (typeof fromEnv === 'string' && fromEnv.length) return fromEnv;
        return null;
    }

    /**
     * Returns the pool, creating it on first use. Throws with an admin-readable message when the
     * connection string is missing or unparseable — the routes turn that into an in-band error.
     */
    private getPool(): mysql.Pool {
        const connectionString = this.getConnectionString();
        if (!connectionString) {
            throw new Error(
                `No ARP database connection configured. Set the ${CONNECTION_ENV_VAR} environment variable`
                + ` or the arp.mysqlConnection setting.`
            );
        }

        //Rebuild the pool if the connection string changed since it was created
        if (this.pool && this.poolSource === connectionString) return this.pool;
        if (this.pool) {
            const stale = this.pool;
            this.pool = null;
            stale.end().catch(() => { });
        }

        const parsed = parseDotNetConnectionString(connectionString);
        if (typeof parsed === 'string') {
            throw new Error(`Invalid ARP database connection string: ${parsed}.`);
        }

        this.pool = mysql.createPool({
            ...parsed,
            connectionLimit: 4,
            waitForConnections: true,
            connectTimeout: 5000,
            //DECIMAL columns stay strings (mysql2's default): money is rendered and edited as
            //typed, and a round-trip through a JS float is exactly how cents get lost
            supportBigNumbers: true,
        });
        this.poolSource = connectionString;
        console.verbose.log(`Connected to ${parsed.host}:${parsed.port}/${parsed.database}`);
        return this.pool;
    }

    /**
     * Runs a read query. Rejects anything that is not a SELECT: this module is the read half of a
     * deliberate split, and a stray write here would bypass the server's validation and audit.
     */
    public async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
        if (!/^\s*select\b/i.test(sql)) {
            throw new Error('ArpDb is read-only — only SELECT statements are allowed.');
        }
        const [rows] = await this.getPool().query(sql, params);
        return rows as T[];
    }

    /** Convenience for the many single-row lookups. */
    public async queryFirst<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
        const rows = await this.query<T>(sql, params);
        return rows[0];
    }

    /** True when a connection string is available at all — used to explain an empty page. */
    public get isConfigured(): boolean {
        return this.getConnectionString() !== null;
    }

    public async handleShutdown() {
        if (!this.pool) return;
        const pool = this.pool;
        this.pool = null;
        this.poolSource = null;
        try {
            await pool.end();
        } catch (error) {
            console.verbose.dir(error);
        }
    }
}

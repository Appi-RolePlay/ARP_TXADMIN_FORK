import { z } from "zod";
import { typeNullableConfig } from "./utils";
import { SYM_FIXER_DEFAULT } from "@lib/symbols";


/**
 * ARP gamemode integration (fork-only scope).
 *
 * The game config page reads the gamemode's MySQL databases directly (read-only). Normally the
 * connection string comes from the ARP_MYSQL_CONNECTION environment variable, which the fxserver
 * already needs — this setting only exists for deployments where that variable is not exported to
 * the txAdmin process. When set, it wins over the environment.
 */
const mysqlConnection = typeNullableConfig({
    name: 'ARP MySQL Connection String',
    default: null,
    validator: z.string().min(1).nullable(),
    fixer: SYM_FIXER_DEFAULT,
});


export default {
    mysqlConnection,
} as const;

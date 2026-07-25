import { useRef, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import GenericSpinner from '@/components/GenericSpinner';
import { useBackendApi } from '@/hooks/fetch';
import type { ArpRowsTarget, GetArpRowsSuccessResp } from '@shared/arpConfigTypes';
import type { GetArpRowsResp } from '@shared/otherTypes';
import { useArpConfigAction } from './useArpConfigApi';

/**
 * The columns the server's `arp_cfg rows` command accepts. Nothing else is editable here, because
 * nothing else is editable there — the whitelist lives in the game server and this mirrors it.
 */
const VEHINFO_COLUMNS = ['price', 'price_dc', 'trunk_capacity'] as const;
const ITEMTPL_COLUMNS = ['price', 'max_stack', 'weight', 'volume'] as const;

type EditableCellProps = {
    value: string | number;
    disabled: boolean;
    onCommit: (value: string) => void;
};

function EditableCell({ value, disabled, onCommit }: EditableCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(String(value));
    //Enter commits and closes the editor, which can also fire onBlur — each commit is an audited
    //write, so the second one must not go through
    const committed = useRef(false);

    if (!isEditing) {
        return (
            <button
                type="button"
                className="w-full text-left font-mono text-xs px-1 py-0.5 rounded hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                disabled={disabled}
                onClick={() => {
                    setDraft(String(value));
                    committed.current = false;
                    setIsEditing(true);
                }}
            >
                {String(value)}
            </button>
        );
    }

    const commit = () => {
        if (committed.current) return;
        committed.current = true;
        const next = draft.trim();
        setIsEditing(false);
        if (next && next !== String(value)) onCommit(next);
    };

    return (
        <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { committed.current = true; setIsEditing(false); }
            }}
            className="h-7 font-mono text-xs"
        />
    );
}

type RowsTabProps = {
    disabled: boolean;
};

/**
 * Audited per-row edits of the hand-maintained definition tables. Every commit goes through the
 * server command, which validates the value, writes the audit entry in log_admin and reloads the
 * affected cache.
 */
export default function RowsTab({ disabled }: RowsTabProps) {
    const [target, setTarget] = useState<ArpRowsTarget>('vehinfo');
    const [search, setSearch] = useState('');
    const [submitted, setSubmitted] = useState('');
    const runAction = useArpConfigAction();

    const queryApi = useBackendApi<GetArpRowsResp>({
        method: 'GET',
        path: '/arp/config/rows',
        throwGenericErrors: true,
    });

    const swr = useSWR(`/arp/config/rows?${target}&${submitted}`, async () => {
        const data = await queryApi({ queryParams: { target, q: submitted } });
        if (!data) throw new Error('No data returned');
        if ('error' in data) throw new Error(data.error);
        return data as GetArpRowsSuccessResp;
    }, { revalidateOnFocus: false });

    const reload = () => swr.mutate();

    return (
        <div className="space-y-3">
            <Tabs value={target} onValueChange={(v) => setTarget(v as ArpRowsTarget)}>
                <TabsList>
                    <TabsTrigger value="vehinfo">Vehicles</TabsTrigger>
                    <TabsTrigger value="itemtpl">Items</TabsTrigger>
                    <TabsTrigger value="carstock">Car stock</TabsTrigger>
                </TabsList>
            </Tabs>

            <form
                className="flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); setSubmitted(search.trim()); }}
            >
                <Input
                    placeholder={target === 'itemtpl' ? 'Search by id, name or label...' : 'Search by model name...'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-sm"
                />
                <Button type="submit" variant="secondary">Search</Button>
            </form>

            {swr.isLoading ? (
                <GenericSpinner msg="Loading rows..." />
            ) : swr.error ? (
                <p className="text-sm text-destructive">{(swr.error as Error).message}</p>
            ) : (
                <div className="border rounded-lg overflow-x-auto">
                    {target === 'vehinfo' && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="min-w-[12rem]">Model</TableHead>
                                    {VEHINFO_COLUMNS.map((col) => (
                                        <TableHead key={col} className="w-40">{col}</TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {swr.data?.vehinfo?.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="font-mono text-xs">{row.displayName}</TableCell>
                                        {VEHINFO_COLUMNS.map((col) => (
                                            <TableCell key={col}>
                                                <EditableCell
                                                    value={col === 'price' ? row.price : col === 'price_dc' ? row.priceDc : row.trunkCapacity}
                                                    disabled={disabled}
                                                    onCommit={(value) => runAction(
                                                        { action: 'rows.setVehInfo', displayName: row.displayName, column: col, value },
                                                        (applied) => { if (applied) reload(); },
                                                    )}
                                                />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {target === 'itemtpl' && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-20">id</TableHead>
                                    <TableHead className="min-w-[12rem]">Item</TableHead>
                                    {ITEMTPL_COLUMNS.map((col) => (
                                        <TableHead key={col} className="w-32">{col}</TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {swr.data?.itemtpl?.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="font-mono text-xs">{row.id}</TableCell>
                                        <TableCell>
                                            <div className="text-xs">{row.label}</div>
                                            <div className="font-mono text-xs text-muted-foreground">{row.name}</div>
                                        </TableCell>
                                        {ITEMTPL_COLUMNS.map((col) => (
                                            <TableCell key={col}>
                                                <EditableCell
                                                    value={
                                                        col === 'price' ? row.price
                                                            : col === 'max_stack' ? row.maxStack
                                                                : col === 'weight' ? row.weight
                                                                    : row.volume
                                                    }
                                                    disabled={disabled}
                                                    onCommit={(value) => runAction(
                                                        { action: 'rows.setItemTpl', id: row.id, column: col, value },
                                                        (applied) => { if (applied) reload(); },
                                                    )}
                                                />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {target === 'carstock' && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="min-w-[12rem]">Model</TableHead>
                                    <TableHead className="w-40">max_count</TableHead>
                                    <TableHead className="w-28">owned</TableHead>
                                    <TableHead className="w-28">available</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {swr.data?.carstock?.map((row) => (
                                    <TableRow key={row.displayName}>
                                        <TableCell className="font-mono text-xs">{row.displayName}</TableCell>
                                        <TableCell>
                                            <EditableCell
                                                value={row.maxCount}
                                                disabled={disabled}
                                                onCommit={(value) => runAction(
                                                    { action: 'rows.setCarStock', displayName: row.displayName, value },
                                                    (applied) => { if (applied) reload(); },
                                                )}
                                            />
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">{row.owned}</TableCell>
                                        <TableCell className="font-mono text-xs">{row.available}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            )}

            {swr.data?.truncated && (
                <p className="text-xs text-muted-foreground">
                    Showing the first 50 matches — narrow the search to see the rest.
                </p>
            )}
        </div>
    );
}

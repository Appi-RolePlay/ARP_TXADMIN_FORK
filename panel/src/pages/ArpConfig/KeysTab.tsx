import { useState } from 'react';
import { CheckIcon, PencilIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ArpConfigKeyRow } from '@shared/arpConfigTypes';
import { useArpConfigAction } from './useArpConfigApi';

type KeysTabProps = {
    keys: ArpConfigKeyRow[];
    disabled: boolean;
    onChanged: () => void;
};

/**
 * The key registry with its three layers made visible: the compiled default, the value the active
 * artifact overrides it with, and any edit staged in the draft. Editing only ever stages a draft —
 * publishing and activating are deliberate separate steps, exactly as on the console.
 */
export default function KeysTab({ keys, disabled, onChanged }: KeysTabProps) {
    const [filter, setFilter] = useState('');
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const runAction = useArpConfigAction();

    const needle = filter.trim().toLowerCase();
    const visible = needle
        ? keys.filter((k) => k.key.toLowerCase().includes(needle) || k.description.toLowerCase().includes(needle))
        : keys;

    const startEdit = (row: ArpConfigKeyRow) => {
        setEditingKey(row.key);
        setEditValue(row.draftJson ?? row.effectiveJson);
    };

    const cancelEdit = () => {
        setEditingKey(null);
        setEditValue('');
    };

    const commitEdit = (row: ArpConfigKeyRow) => {
        const value = editValue.trim();
        if (!value) return;
        runAction({ action: 'keys.set', key: row.key, value }, (applied) => {
            if (applied) {
                cancelEdit();
                onChanged();
            }
        });
    };

    const unsetDraft = (row: ArpConfigKeyRow) => {
        runAction({ action: 'keys.unset', key: row.key }, (applied) => {
            if (applied) onChanged();
        });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <Input
                    placeholder="Filter keys..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="max-w-sm"
                />
                <span className="text-sm text-muted-foreground">
                    {visible.length} of {keys.length} key(s)
                </span>
            </div>

            {!keys.length ? (
                <p className="text-sm text-muted-foreground">
                    The key registry is empty. It is written by the game server on boot, so this
                    usually means the server has not started since the registry table was created.
                </p>
            ) : (
                <div className="border rounded-lg overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[16rem]">Key</TableHead>
                                <TableHead className="w-20">Kind</TableHead>
                                <TableHead className="min-w-[10rem]">Default</TableHead>
                                <TableHead className="min-w-[14rem]">Effective</TableHead>
                                <TableHead className="min-w-[14rem]">Draft</TableHead>
                                <TableHead className="w-28 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visible.map((row) => {
                                const isEditing = editingKey === row.key;
                                const isOverridden = row.activeJson !== null;
                                return (
                                    <TableRow key={row.key}>
                                        <TableCell className="align-top">
                                            <div className="font-mono text-xs break-all">{row.key}</div>
                                            <div className="text-xs text-muted-foreground">{row.description}</div>
                                            {row.clientVisible && (
                                                <Badge variant="outline" className="mt-1">pushed to clients</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="align-top text-xs">{row.kind}</TableCell>
                                        <TableCell className="align-top font-mono text-xs break-all text-muted-foreground">
                                            {row.defaultJson}
                                        </TableCell>
                                        <TableCell className="align-top font-mono text-xs break-all">
                                            {row.effectiveJson}
                                            {isOverridden && (
                                                <Badge variant="secondary" className="ml-2 align-middle">artifact</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {isEditing ? (
                                                <Input
                                                    autoFocus
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') commitEdit(row);
                                                        if (e.key === 'Escape') cancelEdit();
                                                    }}
                                                    className="font-mono text-xs h-8"
                                                />
                                            ) : row.draftJson !== null ? (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="font-mono text-xs break-all text-warning-inline">
                                                                {row.draftJson}
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Staged by {row.draftBy || 'unknown'}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="align-top text-right whitespace-nowrap">
                                            {isEditing ? (<>
                                                <Button
                                                    size="icon" variant="ghost" className="size-8"
                                                    disabled={disabled}
                                                    title="Stage in draft"
                                                    onClick={() => commitEdit(row)}
                                                >
                                                    <CheckIcon className="size-4" />
                                                </Button>
                                                <Button
                                                    size="icon" variant="ghost" className="size-8"
                                                    title="Cancel"
                                                    onClick={cancelEdit}
                                                >
                                                    <XIcon className="size-4" />
                                                </Button>
                                            </>) : (<>
                                                <Button
                                                    size="icon" variant="ghost" className="size-8"
                                                    disabled={disabled}
                                                    title="Edit"
                                                    onClick={() => startEdit(row)}
                                                >
                                                    <PencilIcon className="size-4" />
                                                </Button>
                                                <Button
                                                    size="icon" variant="ghost" className="size-8"
                                                    disabled={disabled || row.draftJson === null}
                                                    title="Drop from draft"
                                                    onClick={() => unsetDraft(row)}
                                                >
                                                    <RotateCcwIcon className="size-4" />
                                                </Button>
                                            </>)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

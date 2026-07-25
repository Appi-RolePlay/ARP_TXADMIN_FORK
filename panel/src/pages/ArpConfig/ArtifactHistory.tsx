import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOpenConfirmDialog } from '@/hooks/dialogs';
import { dateToLocaleDateTimeString } from '@/lib/dateTime';
import type { ArpConfigArtifact } from '@shared/arpConfigTypes';
import { useArpConfigAction } from './useArpConfigApi';

type ArtifactHistoryProps = {
    artifacts: ArpConfigArtifact[];
    activeArtifactId: number | null;
    disabled: boolean;
    onChanged: () => void;
};

/**
 * Published artifacts, newest first. Activation is what actually changes the running server, so
 * both it and rollback sit behind a confirm dialog.
 */
export default function ArtifactHistory({
    artifacts, activeArtifactId, disabled, onChanged,
}: ArtifactHistoryProps) {
    const openConfirmDialog = useOpenConfirmDialog();
    const runAction = useArpConfigAction();

    const confirmActivate = (artifact: ArpConfigArtifact) => {
        openConfirmDialog({
            title: `Activate artifact #${artifact.id}?`,
            message: `This replaces the running configuration with the ${artifact.keyCount} key(s)`
                + ` of this snapshot and pushes the client-visible ones to every player in game.`,
            actionLabel: 'Activate',
            onConfirm: () => {
                runAction({ action: 'keys.activate', artifactId: artifact.id }, (applied) => {
                    if (applied) onChanged();
                });
            },
        });
    };

    const confirmRollback = () => {
        openConfirmDialog({
            title: 'Roll back to the previous artifact?',
            message: 'The artifact published before the active one becomes active again.',
            actionLabel: 'Roll back',
            confirmBtnVariant: 'destructive',
            onConfirm: () => {
                runAction({ action: 'keys.rollback' }, (applied) => {
                    if (applied) onChanged();
                });
            },
        });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">Artifacts</h3>
                <Button
                    size="sm" variant="outline"
                    disabled={disabled || activeArtifactId === null}
                    onClick={confirmRollback}
                >
                    Roll back
                </Button>
            </div>

            {!artifacts.length ? (
                <p className="text-sm text-muted-foreground">
                    Nothing published yet — the server is running on compiled defaults.
                </p>
            ) : (
                <ul className="space-y-2">
                    {artifacts.map((artifact) => (
                        <li
                            key={artifact.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 odd:bg-card/75"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold">#{artifact.id}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {artifact.sha.slice(0, 8)}
                                    </span>
                                    {artifact.isActive && <Badge variant="default">active</Badge>}
                                    <span className="text-xs text-muted-foreground">
                                        {artifact.keyCount} key(s)
                                    </span>
                                </div>
                                <div className="text-sm break-words">{artifact.comment}</div>
                                <div className="text-xs text-muted-foreground">
                                    {artifact.author}
                                    {artifact.createdAt && ` · ${dateToLocaleDateTimeString(new Date(artifact.createdAt), 'short', 'short')}`}
                                </div>
                            </div>
                            <Button
                                size="sm" variant="secondary"
                                disabled={disabled || artifact.isActive}
                                onClick={() => confirmActivate(artifact)}
                            >
                                Activate
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

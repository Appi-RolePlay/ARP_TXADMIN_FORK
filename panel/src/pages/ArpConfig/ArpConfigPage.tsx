import useSWR from 'swr';
import { SlidersHorizontalIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import GenericSpinner from '@/components/GenericSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBackendApi } from '@/hooks/fetch';
import { useOpenPromptDialog } from '@/hooks/dialogs';
import type { GetArpKeysSuccessResp } from '@shared/arpConfigTypes';
import type { GetArpKeysResp } from '@shared/otherTypes';
import ArtifactHistory from './ArtifactHistory';
import KeysTab from './KeysTab';
import RowsTab from './RowsTab';
import { useArpConfigAction } from './useArpConfigApi';

const KEYS_SWR_KEY = '/arp/config/keys';

function ArpConfigPageInner() {
    const openPromptDialog = useOpenPromptDialog();
    const runAction = useArpConfigAction();

    const queryApi = useBackendApi<GetArpKeysResp>({
        method: 'GET',
        path: KEYS_SWR_KEY,
        throwGenericErrors: true,
    });

    const swr = useSWR(KEYS_SWR_KEY, async () => {
        const data = await queryApi({});
        if (!data) throw new Error('No data returned');
        if ('error' in data) throw new Error(data.error);
        return data as GetArpKeysSuccessResp;
    }, { revalidateOnFocus: false });

    if (swr.isLoading) return <GenericSpinner msg="Loading game config..." />;
    if (swr.error) {
        return (
            <Alert variant="destructive">
                <AlertTitle>Could not load the game config</AlertTitle>
                <AlertDescription>{(swr.error as Error).message}</AlertDescription>
            </Alert>
        );
    }

    const data = swr.data!;
    //Every mutation is a console command, so nothing is editable while the server is down
    const disabled = !data.serverOnline;

    const promptPublish = () => {
        openPromptDialog({
            title: 'Publish the draft',
            message: `This freezes the ${data.draftCount} staged change(s) into a new artifact.`
                + ` It does not apply them — activate the artifact afterwards.`,
            placeholder: 'What is changing and why',
            required: true,
            submitLabel: 'Publish',
            onSubmit: (comment) => {
                runAction({ action: 'keys.publish', comment }, (applied) => {
                    if (applied) swr.mutate();
                });
            },
        });
    };

    return (
        <div className="space-y-4">
            {disabled && (
                <Alert variant="destructive">
                    <AlertTitle>The server is offline</AlertTitle>
                    <AlertDescription>
                        Values below are read from the database, but nothing can be changed: every
                        edit is applied by the game server itself.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs defaultValue="keys">
                <TabsList>
                    <TabsTrigger value="keys">Keys</TabsTrigger>
                    <TabsTrigger value="rows">Rows</TabsTrigger>
                </TabsList>

                <TabsContent value="keys" className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm text-muted-foreground">
                            Active artifact:{' '}
                            {data.activeArtifactId !== null
                                ? <span className="font-semibold text-foreground">#{data.activeArtifactId}</span>
                                : <span className="italic">none (compiled defaults)</span>}
                            {data.activatedBy && ` · activated by ${data.activatedBy}`}
                        </div>
                        <div className="flex items-center gap-2">
                            {data.draftCount > 0 && (
                                <Badge variant="secondary">{data.draftCount} staged change(s)</Badge>
                            )}
                            <Button
                                size="sm"
                                disabled={disabled || data.draftCount === 0}
                                onClick={promptPublish}
                            >
                                Publish draft
                            </Button>
                        </div>
                    </div>

                    <KeysTab keys={data.keys} disabled={disabled} onChanged={() => swr.mutate()} />

                    <ArtifactHistory
                        artifacts={data.artifacts}
                        activeArtifactId={data.activeArtifactId}
                        disabled={disabled}
                        onChanged={() => swr.mutate()}
                    />
                </TabsContent>

                <TabsContent value="rows">
                    <RowsTab disabled={disabled} />
                </TabsContent>
            </Tabs>
        </div>
    );
}


export default function ArpConfigPage() {
    return (
        <div className="w-full mb-10">
            <PageHeader icon={<SlidersHorizontalIcon />} title="Game Config" />
            <div className="px-0 xs:px-3 md:px-0 w-full">
                <ArpConfigPageInner />
            </div>
        </div>
    );
}

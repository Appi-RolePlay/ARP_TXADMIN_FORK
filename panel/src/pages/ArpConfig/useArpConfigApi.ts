import { ApiTimeout, useBackendApi } from '@/hooks/fetch';
import { txToast } from '@/components/TxToaster';
import type { RunArpActionResp } from '@shared/otherTypes';
import type { ArpConfigAction } from '@shared/arpConfigTypes';

/**
 * Runs one game-config command on the server.
 *
 * The request outlives a normal API call on purpose: the route sends the command to the fxserver
 * console and then waits for the server to write back its own verdict, which takes as long as the
 * action takes. The timeout has to cover that wait, otherwise a slow but successful publish would
 * be reported as a failure.
 *
 * Three outcomes are worth telling apart: the request failed, the server ran the command and
 * refused it (that reason is the useful part), or it applied it.
 */
export const useArpConfigAction = () => {
    const runApi = useBackendApi<RunArpActionResp, ArpConfigAction>({
        method: 'POST',
        path: '/arp/config/action',
    });

    return (action: ArpConfigAction, onDone?: (applied: boolean) => void) => {
        runApi({
            data: action,
            timeout: ApiTimeout.LONG,
            toastLoadingMessage: 'Running config command...',
            success: (resp, toastId) => {
                if ('error' in resp) {
                    txToast.error({ title: 'Config command failed', msg: resp.error }, { id: toastId });
                    onDone?.(false);
                } else if (resp.status === 'ok') {
                    txToast.success({ title: 'Applied', msg: resp.message }, { id: toastId });
                    onDone?.(true);
                } else {
                    txToast.error({ title: 'Rejected by the server', msg: resp.message }, { id: toastId });
                    onDone?.(false);
                }
            },
            error: (message, toastId) => {
                txToast.error({ title: 'Config command failed', msg: message }, { id: toastId });
                onDone?.(false);
            },
        });
    };
};

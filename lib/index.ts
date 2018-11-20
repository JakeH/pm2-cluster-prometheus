import * as pm2 from 'pm2';
import * as client from 'prom-client';

interface ProcessPacket {
    /**
     * The message topic
     */
    topic: string;

    /**
    * The PM2 proc id the message is currently on (seems weird, but PM2 is changing this id)
    */
    id: number;

    /**
     * The data payload of this packet
     */
    data: any;

    /**
     * Is this message a reply
     */
    isReply?: boolean;

    /**
     * PM2 id which is expecting the reply
     */
    replyTo?: number;

    /**
     * The originating PM2 proc id
     */
    originalProcId: number;
}

/**
 * This process's PM proc id
 */
const currentProcId = parseInt(process.env.pm_id, 10);

/**
 * Indicates the process is being ran in PM2's cluster mode
 */
export const isClusterMode = process.env.exec_mode === 'cluster_mode';

/**
 * Returns a list of PM2 processes when running in clustered mode
 */
function getProcList(): Promise<Array<pm2.ProcessDescription>> {
    return new Promise((resolve, reject) => {
        pm2.list((err, list) => {
            err ? reject(err) : resolve(list);
        });
    });
}

/**
 * Broadcasts message to all processes in the cluster, resolving with the number of processes sent to
 * @param packet The packet to send
 */
async function broadcastToAll(packet: ProcessPacket): Promise<number> {
    return getProcList().then(list => {
        list.forEach(proc => pm2.sendDataToProcessId(proc.pm_id, packet, err => true));
        return list.length;
    });
}

/**
 * Sends a message to all processes in the cluster and resolves once all processes repsonsed or after a timeout
 * @param topic The name of the topic to broadcast
 * @param data The optional data payload
 * @param timeoutInMilliseconds The length of time to wait for responses before rejecting the promise
 */
function awaitAllProcMessagesReplies(topic: string, timeoutInMilliseconds: number): Promise<Array<ProcessPacket>> {

    return new Promise(async (resolve, reject) => {
        const responses = [];

        const procLength = await broadcastToAll({
            id: currentProcId,
            replyTo: currentProcId,
            originalProcId: currentProcId,
            topic,
            data: {},
            isReply: false,
        });

        const timeoutHandle = setTimeout(() => reject('timeout'), timeoutInMilliseconds);

        const handler = (response: ProcessPacket) => {

            if (!response.isReply || response.topic !== topic) {
                return;
            }

            responses.push(response);

            if (responses.length === procLength) {
                process.removeListener('message', handler);
                clearTimeout(timeoutHandle);
                resolve(responses);
            }
        };

        process.on('message', handler);

    });

}

/**
 * Sends a reply to the processes which originated a broadcast
 * @param originalPacket The original packet received
 * @param data The optional data to responed with
 */
function sendProcReply(originalPacket: ProcessPacket, data: any = {}) {

    const returnPacket: ProcessPacket = {
        ...originalPacket,
        data,
        isReply: true,
        id: currentProcId,
        originalProcId: currentProcId,
    };

    pm2.sendDataToProcessId(originalPacket.replyTo, returnPacket, err => true);
}

/**
 * Init
 */
if (isClusterMode) {
    const handleProcessMessage = (packet: ProcessPacket) => {
        if (packet && packet.topic === 'metrics-get' && !packet.isReply) {
            sendProcReply(packet, client.register.getMetricsAsJSON());
        }
    };
    process.removeListener('message', handleProcessMessage);
    process.on('message', handleProcessMessage);
}

/**
 * Returns the aggregate metric if running in cluster mode, otherwise, just the current
 * instance's metrics
 * @param timeoutInMilliseconds How long to wait for other processes to provide their metrics. 
 */
export async function getAggregateMetrics(timeoutInMilliseconds: number = 10e3): Promise<client.Registry> {

    if (isClusterMode) {
        const procMetrics = await awaitAllProcMessagesReplies('metrics-get', timeoutInMilliseconds);
        return client.AggregatorRegistry.aggregate(procMetrics.map(o => o.data));
    } else {
        return client.register;
    }

}

/**
 * Creates a timer which executes when the current time is cleanly divisible by `syncTimeInMS`
 * @param syncTimeInMilliseconds The time, in milliseconds
 * @param fun The function to execute
 * @returns The timer handle
 */
export function timeSyncRun(syncTimeInMilliseconds: number, fun: () => void): NodeJS.Timer {
    const handle = setTimeout(fun, syncTimeInMilliseconds - Date.now() % syncTimeInMilliseconds);
    handle.unref();
    return handle;
}

const os = require("os");
const _ = require("lodash");
const MessageQueuedResourceClass = require("../../resources/message-queued");
const processMessages = require("./process");
/**
 *
 *
 * @param {*} { removeBuffer = false }
 * @returns
 */
module.exports = async ({ removeBuffer = false }) => {
	// Load the queue scripts
	let messageHandlers = {};
	let queueSettings = {};
	try {
		const config = require(`${process.cwd()}/mq-config`);
		messageHandlers = config.messageHandlers;
		queueSettings = config.queueSettings;
	} catch (err) {
		// set to default
		messageHandlers = {};
		// console.error(err);
	}
	const MessageQueuedResource = new MessageQueuedResourceClass();

	// Set a batchId for the messages being processed
	// const batchId = uuidv1();
	const dockerId = os.hostname;
	const appInstanceId = process.env.INSTANCE_ID || 0;
	const nodeId = `${dockerId}-${appInstanceId}`;

	// Handle messages
	try {
		const [queueError, queueMessages] = await MessageQueuedResource.findMany({
			query: {
				resultsPerPage: queueSettings.batchCount
					? 1000 // limit per batch
					: queueSettings.batchCount || 1000,
				sort: "1|createdAtConverted|",
				nodeId,
				status: "queued",
				topic: {
					$in: [...Object.keys(messageHandlers), ...["internal-test"]]
				}
			}
		});

		if (queueError) throw new Error(queueError);

		// Messages to be published out to subscribers
		const [pubMsgError, pubMsgResult] = await MessageQueuedResource.findMany({
			query: {
				resultsPerPage: queueSettings.batchCount
					? 1000 // limit per batch
					: queueSettings.batchCount || 1000,
				nodeId,
				status: "queued",
				sort: "1|createdAtConverted|",
				source: os.hostname
			}
		});

		if (pubMsgError) throw new Error(pubMsgError);

		// Get the data from both categories of messages
		const messagesToProcess = _.get(queueMessages, "data");
		const messagesToPublish = _.get(pubMsgResult, "data");
		// Check that we have messages before processing
		if ([...messagesToPublish, ...messagesToProcess].length > 0) {
			// Update message status to in_flight
			const [updateManyError] = await MessageQueuedResource.updateMany({
				query: { nodeId },
				object: { nodeId: null, status: "in_flight", assignedAt: null }
			});
			if (updateManyError) throw new Error(updateManyError);

			// Process messages claimed
			const [processError] = await processMessages({
				messages: [...messagesToPublish, ...messagesToProcess],
				nodeId,
				messageHandlers
			});

			if (processError) throw new Error(processError);
		}
		return [
			undefined,
			{
				status: "messages processed",
				totalMessages: 100
			}
		];
	} catch (error) {
		console.error(error);
		return [error, undefined];
	}
};

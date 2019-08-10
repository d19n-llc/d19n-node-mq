const { seriesLoop } = require("../../helpers/functions");
const { isPastQueueBuffer } = require("../../helpers/processing");
const handleCleanUpOnError = require("./clean-up");

const InFlightResourceClass = require("../../resources/message-inflight");
const ProcessedResourceClass = require("../../resources/message-processed");
const ProcessMessageTest = require("../../scripts/test/process-a-message");
const PublishMessage = require("../publish/message");
/**
 *
 *
 * @param {*} {
 * 	messages,
 * 	batchId,
 * 	messageHandlers,
 * 	removeBuffer
 * }
 * @returns
 */
module.exports = async ({
	messages,
	batchId,
	messageHandlers,
	removeBuffer
}) => {
	const InFlightResource = new InFlightResourceClass();
	const ProcessedResource = new ProcessedResourceClass();

	/**
	 * When a message is successfully processed, we want to remove it from
	 * inflight and move it to processed.
	 *
	 */
	async function handleProcessedMessage({ message }) {
		// Move message to processed
		const [moveError] = await ProcessedResource.createOne({
			object: message
		});
		if (moveError) {
			await handleCleanUpOnError({
				message,
				batchId,
				errorMessage: moveError ? moveError.message : ""
			});
		}
		// Remove message from inflight
		const [removeError] = await InFlightResource.deleteOne({
			query: { _id: message._id }
		});
		if (removeError) {
			await handleCleanUpOnError({
				message,
				batchId,
				errorMessage: removeError ? removeError.message : ""
			});
		}
	}

	try {
		// process jobs
		await seriesLoop(messages, async (message, index) => {
			const currentMessage = Object.assign({}, message, { batchId });
			if (
				isPastQueueBuffer({ messageCreatedAt: message.createTime }) ||
				removeBuffer
			) {
				const { source, topic } = message;
				// Test processing works.
				if (source === "test-script") {
					const [error, result] = await ProcessMessageTest({ message });
					if (error) {
						await handleCleanUpOnError({
							currentMessage,
							batchId,
							errorMessage: error ? error.message : ""
						});
					} else {
						handleProcessedMessage({ message: currentMessage });
					}
				} else if (process.env.APP_URL && source === process.env.APP_URL) {
					// If the source is the APP_URL that means this message should be published
					// to all subscribers and not processed internally with the script registry.
					const [error, result] = await PublishMessage({ message });
					if (error) {
						await handleCleanUpOnError({
							currentMessage,
							batchId,
							errorMessage: error ? error.message : ""
						});
					} else {
						handleProcessedMessage({ message: currentMessage });
					}
				} else if (
					source !== process.env.APP_URL &&
					messageHandlers[`${topic}`]
				) {
					// If the source is not the current APP and their is a script then
					// Use the script with the key === to the message topic
					const [error, result] = await messageHandlers[`${topic}`]({
						message
					});
					if (error) {
						await handleCleanUpOnError({
							currentMessage,
							batchId,
							errorMessage: error ? error.message : ""
						});
					} else {
						handleProcessedMessage({ message: currentMessage });
					}
				}
			}
		});

		return [
			undefined,
			{ status: "processed messages", total: messages.length }
		];
	} catch (error) {
		return [error, undefined];
	}
};

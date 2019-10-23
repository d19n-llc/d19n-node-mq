const schedule = require("node-schedule");
const electNodes = require("../services/elect-nodes");
const assignNodes = require("../services/assign-nodes");
const deduplicateQueue = require("../services/deduplicate");
const clearMessageLocks = require("../services/workers/clear-message-locks");
const processQueuedMessages = require("../services/queue");
const retryFailedMessages = require("../services/retry-failed");
const { offsetJobStart } = require("../helpers/processing");

// *    *    *    *    *    *
// ┬    ┬    ┬    ┬    ┬    ┬
// │    │    │    │    │    │
// │    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
// │    │    │    │    └───── month (1 - 12)
// │    │    │    └────────── day of month (1 - 31)
// │    │    └─────────────── hour (0 - 23)
// │    └──────────────────── minute (0 - 59)
// └───────────────────────── second (0 - 59, OPTIONAL)

function Scheduler() {
	let queueSettings = {};
	try {
		// eslint-disable-next-line global-require
		const config = require(`${process.cwd()}/mq-config`);
		queueSettings = config.queueSettings;
	} catch (err) {
		// set to default
		queueSettings = {};
	}
	// Deduplicate message queue
	schedule.scheduleJob(
		`${queueSettings.electNodes || 0} * * * * *`,
		async () => {
			await offsetJobStart({ appInstance: queueSettings.appInstanceId });
			electNodes({});
		}
	);

	schedule.scheduleJob(
		`${queueSettings.assignNodes || 0} * * * * *`,
		async () => {
			await offsetJobStart({ appInstance: queueSettings.appInstanceId });
			assignNodes({});
		}
	);
	// Releases locked messages in the queue
	schedule.scheduleJob(
		`${queueSettings.clearMessageLocks || 0} * * * * *`,
		() => {
			clearMessageLocks({});
		}
	);
	// Deduplicate message queue
	schedule.scheduleJob(
		`${queueSettings.deduplicateQueueEvery || 0} * * * * *`,
		() => {
			deduplicateQueue({});
		}
	);
	// Process messages queued
	schedule.scheduleJob(
		`${queueSettings.processQueueEvery || 0} * * * * *`,
		async () => {
			await offsetJobStart({ appInstance: queueSettings.appInstanceId });
			processQueuedMessages({});
		}
	);
	// Retry failed messages
	schedule.scheduleJob(
		`${queueSettings.retryFailedEvery || 0} * * * * *`,
		async () => {
			await offsetJobStart({ appInstance: queueSettings.appInstanceId });
			retryFailedMessages({});
		}
	);
}

Scheduler();

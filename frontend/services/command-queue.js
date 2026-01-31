import {
  setRating,
  retagImage,
  addPermatag,
  getPermatags,
  deletePermatag,
  addToList,
  addToRecentList,
  bulkPermatags,
} from './api.js';

const STORAGE_KEY = 'photocat_command_queue_v1';
const CONCURRENCY = 3;
const MAX_RETRIES = 2;

let queue = [];
let inProgress = [];
let failed = [];
let completedCount = 0;
const listeners = new Set();

function saveState() {
  const payload = {
    queue,
    failed,
    completedCount,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Queue: failed to persist state', error);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    queue = Array.isArray(parsed.queue) ? parsed.queue : [];
    failed = Array.isArray(parsed.failed) ? parsed.failed : [];
    completedCount = Number(parsed.completedCount || 0);
  } catch (error) {
    console.error('Queue: failed to load state', error);
  }
}

function getState() {
  return {
    queuedCount: queue.length,
    inProgressCount: inProgress.length,
    failedCount: failed.length,
    completedCount,
    queue: [...queue],
    failed: [...failed],
    inProgress: [...inProgress],
  };
}

function notify() {
  const state = getState();
  listeners.forEach((listener) => listener(state));
  window.dispatchEvent(new CustomEvent('queue-updated', { detail: state }));
  saveState();
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function coalesce(command) {
  if (command.type === 'set-rating') {
    queue = queue.filter(
      (item) => !(item.type === 'set-rating' && item.imageId === command.imageId)
    );
  }

  if (
    command.type === 'add-positive-permatag' ||
    command.type === 'add-negative-permatag'
  ) {
    queue = queue.filter(
      (item) =>
        !(
          (item.type === 'add-positive-permatag' ||
            item.type === 'add-negative-permatag') &&
          item.imageId === command.imageId &&
          item.keyword === command.keyword
        )
    );
  }

  if (command.type === 'retag') {
    queue = queue.filter(
      (item) => !(item.type === 'retag' && item.imageId === command.imageId)
    );
  }
}

async function executeCommand(command) {
  switch (command.type) {
    case 'set-rating':
      return setRating(command.tenantId, command.imageId, command.rating);
    case 'retag':
      return retagImage(command.tenantId, command.imageId);
    case 'add-to-list':
      return addToRecentList(command.tenantId, command.imageId);
    case 'add-negative-permatag':
      return addPermatag(
        command.tenantId,
        command.imageId,
        command.keyword,
        command.category,
        -1
      );
    case 'add-positive-permatag': {
      const permatags = await getPermatags(command.tenantId, command.imageId);
      const existingNegative = (permatags.permatags || []).find(
        (ptag) => ptag.keyword === command.keyword && ptag.signum === -1
      );
      if (existingNegative) {
        await deletePermatag(
          command.tenantId,
          command.imageId,
          existingNegative.id
        );
      }
      return addPermatag(
        command.tenantId,
        command.imageId,
        command.keyword,
        command.category,
        1
      );
    }
    case 'bulk-permatags':
      return bulkPermatags(command.tenantId, command.operations || []);
    default:
      throw new Error(`Unknown command type: ${command.type}`);
  }
}

function scheduleRetry(command) {
  const delay = 1500 * command.attempts;
  setTimeout(() => {
    queue.push(command);
    notify();
    processQueue();
  }, delay);
}

async function processCommand(command) {
  try {
    await executeCommand(command);
    completedCount += 1;
    window.dispatchEvent(
      new CustomEvent('queue-command-complete', { detail: command })
    );
  } catch (error) {
    command.attempts += 1;
    if (command.attempts <= MAX_RETRIES) {
      scheduleRetry(command);
      return;
    }
    failed.push({ ...command, error: String(error) });
    window.dispatchEvent(
      new CustomEvent('queue-command-failed', { detail: command })
    );
  } finally {
    inProgress = inProgress.filter((item) => item.id !== command.id);
    notify();
    processQueue();
  }
}

function processQueue() {
  while (inProgress.length < CONCURRENCY && queue.length > 0) {
    const command = queue.shift();
    inProgress.push(command);
    notify();
    processCommand(command);
  }
}

export function enqueueCommand(command) {
  const next = {
    id: makeId(),
    attempts: 0,
    createdAt: Date.now(),
    ...command,
  };
  coalesce(next);
  queue.push(next);
  notify();
  processQueue();
  return next.id;
}

export function subscribeQueue(listener) {
  listeners.add(listener);
  listener(getState());
  return () => listeners.delete(listener);
}

export function getQueueState() {
  return getState();
}

export function retryFailedCommand(commandId) {
  const index = failed.findIndex((item) => item.id === commandId);
  if (index === -1) return;
  const [command] = failed.splice(index, 1);
  command.attempts = 0;
  queue.push(command);
  notify();
  processQueue();
}

loadState();
processQueue();

// Lưu danh sách việc (job) vào file JSON, đủ dùng cho 1 người ra lệnh.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const file = () => path.join(config.dataDir, 'jobs.json');
let jobs = null;

function load() {
  if (jobs) return jobs;
  try {
    jobs = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    jobs = [];
  }
  return jobs;
}

function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, file());
}

export function createJob({ workflow, title, params, chatId, userId }) {
  load();
  const job = {
    id: 'j' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    workflow,
    title,
    params,
    chatId,
    userId,
    status: 'queued', // queued | running | done | failed
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionUrl: null,
    log: [],
  };
  jobs.push(job);
  save();
  return job;
}

export function updateJob(id, patch, logLine) {
  load();
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  if (logLine) job.log.push({ at: job.updatedAt, text: logLine });
  save();
  return job;
}

export const getJob = (id) => load().find((j) => j.id === id) || null;

export function recentJobs(n = 5) {
  return load().slice(-n).reverse();
}

export function activeJobs(workflow) {
  return load().filter((j) => (!workflow || j.workflow === workflow) && ['queued', 'running'].includes(j.status));
}

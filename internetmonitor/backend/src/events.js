import { EventEmitter } from 'events';

// Global event emitter for real-time updates
export const events = new EventEmitter();

// Event types
export const EVENT_PING_COMPLETE = 'ping:complete';
export const EVENT_SPEEDTEST_COMPLETE = 'speedtest:complete';
export const EVENT_SPEEDTEST_STARTED = 'speedtest:started';
export const EVENT_SPEEDTEST_PROGRESS = 'speedtest:progress';
export const EVENT_DNS_COMPLETE = 'dns:complete';
export const EVENT_PUBLICIP_CHANGE = 'publicip:change';

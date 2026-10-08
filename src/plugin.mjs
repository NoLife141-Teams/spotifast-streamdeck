import streamDeck from '@elgato/streamdeck';
import { createRuntime } from './runtime.mjs';

createRuntime(streamDeck).start().catch(error => streamDeck.logger.error(error));
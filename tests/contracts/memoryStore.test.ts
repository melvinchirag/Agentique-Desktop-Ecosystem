import { InMemoryMemoryStore } from '../../src/main/testing/inMemoryMemoryStore';
import { memoryStoreContract } from './memoryStore.contract';

memoryStoreContract('InMemoryMemoryStore', (now) => new InMemoryMemoryStore(now));

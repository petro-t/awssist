import type { AwssistApi } from '@shared/types';

declare global {
  interface Window {
    awssist: AwssistApi;
  }
}

export {};

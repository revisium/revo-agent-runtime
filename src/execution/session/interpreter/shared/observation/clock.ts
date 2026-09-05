export interface SessionObservationClock {
  now(): { readonly iso: string; readonly milliseconds: number };
}

declare module 'which' {
  interface WhichOptions {
    readonly nothrow: true;
  }

  const which: (command: string, options: WhichOptions) => Promise<string | null>;

  export default which;
}

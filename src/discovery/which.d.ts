declare module 'which' {
  interface WhichOptions {
    readonly nothrow: true;
  }

  interface WhichAllOptions extends WhichOptions {
    readonly all: true;
  }

  const which: {
    (command: string, options: WhichAllOptions): Promise<string[] | null>;
    (command: string, options: WhichOptions): Promise<string | null>;
  };

  export default which;
}

const optionValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

export const fakeAcpOptions = () =>
  Object.freeze({
    configurationStateFile: optionValue('--configuration-state'),
    descendantPidFile: optionValue('--descendant-pid'),
    mode: optionValue('--mode') ?? 'success',
    readyFile: optionValue('--ready'),
    traceFile: optionValue('--trace'),
  });

export interface OutputResourcePlan {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly needsPromptFile: boolean;
  readonly needsResultSchemaFile: boolean;
}

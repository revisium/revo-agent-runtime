import { dirname, posix } from 'node:path';

import {
  ModifierFlags,
  SyntaxKind,
  isArrayBindingPattern,
  isCallExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isExternalModuleReference,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportTypeNode,
  isInterfaceDeclaration,
  isLiteralTypeNode,
  isNamedExports,
  isNamespaceExportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
  type BindingName,
  type Node,
  type SourceFile,
  type Statement,
} from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';

export interface SourceModule {
  readonly path: string;
  readonly source: string;
}

type Rule =
  | 'cross-domain-barrel-import'
  | 'cross-layer-barrel-import'
  | 'explicit-barrel-exports'
  | 'json-object-base-private'
  | 'one-export-per-leaf'
  | 'own-barrel-import'
  | 'relative-js-suffix'
  | 'spec-layer-barrel-import'
  | 'spec-type-only'
  | 'test-layer-barrel-import';

interface ModuleReference {
  readonly target: string;
}

const fail = (rule: Rule, path: string): never => {
  throw new Error(`[${rule}] ${path}`);
};

const normalized = (path: string): string => posix.normalize(path.replaceAll('\\', '/'));

const isBarrel = (path: string): boolean =>
  path !== 'src/index.ts' && posix.basename(path) === 'index.ts';

const isProductionLeaf = (path: string): boolean =>
  path !== 'src/index.ts' && path.startsWith('src/') && path.endsWith('.ts') && !isBarrel(path);

const isSpecModule = (path: string): boolean => path.startsWith('src/runtime/spec/');

const isTypeOnlyCohesionModule = (path: string): boolean =>
  isSpecModule(path) || path.startsWith('src/runtime/probe/executable-probe-port/');

const hasExportModifier = (modifierFlags: ModifierFlags): boolean =>
  (modifierFlags & ModifierFlags.Export) !== 0;

const bindingNameCount = (name: BindingName): number => {
  if (isIdentifier(name)) return 1;
  if (!isObjectBindingPattern(name) && !isArrayBindingPattern(name)) return 0;

  return name.elements.reduce(
    (count, element) => count + (element.name ? bindingNameCount(element.name) : 0),
    0,
  );
};

const exportedEntityCount = (statements: readonly Statement[]): number =>
  statements.reduce((count, statement) => {
    if (isExportDeclaration(statement)) {
      return (
        count +
        (statement.exportClause && isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.length
          : 2)
      );
    }
    if (isExportAssignment(statement) || isNamespaceExportDeclaration(statement)) return count + 1;
    if (isVariableStatement(statement)) {
      if (!hasExportModifier(statement.modifierFlags)) return count;
      return (
        count +
        statement.declarationList.declarations.reduce(
          (names, declaration) => names + bindingNameCount(declaration.name),
          0,
        )
      );
    }
    if (
      (isClassDeclaration(statement) ||
        isEnumDeclaration(statement) ||
        isFunctionDeclaration(statement) ||
        isInterfaceDeclaration(statement) ||
        isTypeAliasDeclaration(statement)) &&
      hasExportModifier(statement.modifierFlags)
    ) {
      return count + 1;
    }
    return count;
  }, 0);

const moduleSpecifierText = (node: Node | undefined): string | undefined => {
  if (node && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))) return node.text;
  return undefined;
};

const validateExplicitBarrel = (path: string, sourceFile: SourceFile): void => {
  if (!isBarrel(path)) return;

  for (const statement of sourceFile.statements) {
    if (
      !isExportDeclaration(statement) ||
      !statement.exportClause ||
      !isNamedExports(statement.exportClause) ||
      moduleSpecifierText(statement.moduleSpecifier) === undefined
    ) {
      fail('explicit-barrel-exports', path);
    }
  }
};

const validateJsonObjectBasePrivacy = (path: string, sourceFile: SourceFile): void => {
  if (!isBarrel(path)) return;

  for (const statement of sourceFile.statements) {
    if (
      isExportDeclaration(statement) &&
      statement.exportClause &&
      isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => (element.propertyName ?? element.name).text === 'JsonObjectBase',
      )
    ) {
      fail('json-object-base-private', path);
    }
  }
};

const validateTypeOnlySyntax = (path: string, sourceFile: SourceFile): void => {
  if (!isTypeOnlyCohesionModule(path)) return;

  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) {
      if (statement.importClause?.phaseModifier !== SyntaxKind.TypeKeyword) {
        fail('spec-type-only', path);
      }
      continue;
    }
    if (isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly) fail('spec-type-only', path);
      continue;
    }
    if (isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)) continue;
    if (isExportDeclaration(statement) && statement.isTypeOnly) continue;
    fail('spec-type-only', path);
  }
};

const referenceFromSpecifier = (
  path: string,
  node: Node | undefined,
): ModuleReference | undefined => {
  const specifier = moduleSpecifierText(node);
  if (!specifier?.startsWith('.')) return undefined;
  if (!specifier.endsWith('.js')) fail('relative-js-suffix', path);

  return {
    target: normalized(posix.join(dirname(path), specifier.replace(/\.js$/, '.ts'))),
  };
};

const moduleReferences = (path: string, sourceFile: SourceFile): readonly ModuleReference[] => {
  const references: ModuleReference[] = [];
  const append = (node: Node | undefined): void => {
    const reference = referenceFromSpecifier(path, node);
    if (reference) references.push(reference);
  };

  const visit = (node: Node): void => {
    if (isImportDeclaration(node) || isExportDeclaration(node)) {
      append(node.moduleSpecifier);
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      append(node.moduleReference.expression);
    } else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (moduleSpecifierText(argument) === undefined) fail('relative-js-suffix', path);
      append(argument);
    } else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
      append(node.argument.literal);
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
  return references;
};

const runtimeLayer = (path: string): string | undefined =>
  /^src\/runtime\/([^/]+)\//.exec(path)?.[1];

const specDomain = (path: string): string | undefined =>
  /^src\/runtime\/spec\/([^/]+)\//.exec(path)?.[1];

const validateImportBoundaries = (path: string, references: readonly ModuleReference[]): void => {
  const layer = runtimeLayer(path);
  const domain = specDomain(path);

  for (const reference of references) {
    if (isProductionLeaf(path)) {
      if (reference.target === normalized(posix.join(dirname(path), 'index.ts'))) {
        fail('own-barrel-import', path);
      }
      if (isSpecModule(path) && reference.target === 'src/runtime/spec/index.ts') {
        fail('spec-layer-barrel-import', path);
      }
    }

    const targetDomain = specDomain(reference.target);
    if (domain && targetDomain && domain !== targetDomain && !isBarrel(reference.target)) {
      fail('cross-domain-barrel-import', path);
    }

    const targetLayer = runtimeLayer(reference.target);
    if (layer && targetLayer && layer !== targetLayer && !isBarrel(reference.target)) {
      fail('cross-layer-barrel-import', path);
    }

    if (path.startsWith('test/') && targetLayer) {
      const expectedTarget = `src/runtime/${targetLayer}/index.ts`;
      if (reference.target !== expectedTarget) fail('test-layer-barrel-import', path);
    }
  }
};

const validateSourceFile = (path: string, sourceFile: SourceFile): void => {
  validateExplicitBarrel(path, sourceFile);
  validateJsonObjectBasePrivacy(path, sourceFile);
  validateTypeOnlySyntax(path, sourceFile);

  if (
    isProductionLeaf(path) &&
    !isTypeOnlyCohesionModule(path) &&
    exportedEntityCount(sourceFile.statements) !== 1
  ) {
    fail('one-export-per-leaf', path);
  }

  validateImportBoundaries(path, moduleReferences(path, sourceFile));
};

export const validateModuleStructure = (modules: readonly SourceModule[]): void => {
  if (modules.length === 0) return;

  const virtualRoot = '/module-structure';
  const configPath = `${virtualRoot}/tsconfig.json`;
  const normalizedModules = modules.map((module) => ({ ...module, path: normalized(module.path) }));
  const files: Record<string, string> = {
    [configPath]: JSON.stringify({ files: normalizedModules.map((module) => module.path) }),
  };
  for (const module of normalizedModules) files[`${virtualRoot}/${module.path}`] = module.source;

  const api = new API({ cwd: virtualRoot, fs: createVirtualFileSystem(files) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const project = snapshot.getProjects()[0];
    if (!project) throw new Error('TypeScript did not create the module-structure project.');

    for (const module of normalizedModules) {
      const sourceFile = project.program.getSourceFile(`${virtualRoot}/${module.path}`);
      if (!sourceFile) throw new Error(`TypeScript did not parse ${module.path}.`);
      validateSourceFile(module.path, sourceFile);
    }
  } finally {
    api.close();
  }
};

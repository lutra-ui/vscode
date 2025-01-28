import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// CSS variable pattern to match --variable-name: value;
const CSS_VAR_PATTERN = /(?:\/\*([^*]*)\*\/\s*)?([^}]*?--[\w-]+:\s*[^;]+;)/g;
// Pattern to match @cssprop documentation
const CSSPROP_DOC_PATTERN = /@cssprop\s+(--[\w-]+)\s*-\s*([^\n]+)/g;
// Pattern to match @property rules with their comment blocks
const PROPERTY_RULE_PATTERN = /\/\*\*([^*]*?)\*\/\s*@property\s+(--[\w-]+)\s*{([^}]+)}/gs;

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel('Lutra CSS Variables');

function log(message: string) {
	const config = vscode.workspace.getConfiguration('lutra');
	if (!config.get<boolean>('enableLogging', false)) {
		return;
	}
	outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
	// Also log to console for debugging
	console.log(`[Lutra] ${message}`);
}

interface CSSVariable {
	name: string;
	description?: string;
	source: 'global' | 'component';
	componentName?: string;
	filePath: string;
}

class CSSVariableCompletionProvider implements vscode.CompletionItemProvider {
	private variables: Map<string, CSSVariable> = new Map();

	constructor() {
		log('Initializing CSSVariableCompletionProvider');
		this.updateVariables();
		// Watch for CSS and Svelte file changes
		const cssWatcher = vscode.workspace.createFileSystemWatcher('**/*.css');
		const svelteWatcher = vscode.workspace.createFileSystemWatcher('**/node_modules/lutra/**/*.svelte');
		
		log('Setting up file watchers for CSS and Svelte files');
		const updateFn = () => {
			log('File change detected, updating variables');
			this.updateVariables();
		};
		[cssWatcher, svelteWatcher].forEach(watcher => {
			watcher.onDidChange(updateFn);
			watcher.onDidCreate(updateFn);
			watcher.onDidDelete(updateFn);
		});
	}

	public async updateVariables() {
		log('Starting variable update');
		this.variables.clear();
		
		// Get configured glob patterns
		const config = vscode.workspace.getConfiguration('lutra');
		const cssPatterns = config.get<string[]>('cssGlobPatterns', ['**/*.css', '**/node_modules/lutra/**/*.css']);
		const sveltePatterns = config.get<string[]>('svelteGlobPatterns', ['**/node_modules/lutra/**/*.svelte']);
		const excludePatterns = config.get<string[]>('excludePatterns', ['**/node_modules/**', '**/dist/**', '**/build/**']);

		// Create important include lists
		const importantCssIncludes = cssPatterns.includes('**/node_modules/lutra/**/*.css') ? ['**/node_modules/lutra/**/*.css'] : [];
		const importantSvelteIncludes = sveltePatterns.includes('**/node_modules/lutra/**/*.svelte') ? ['**/node_modules/lutra/**/*.svelte'] : [];
		
		// Process CSS files
		for (const pattern of cssPatterns) {
			log(`Searching for CSS files matching pattern: ${pattern}`);
			const files = await vscode.workspace.findFiles(
				pattern,
				`{${excludePatterns.join(',')}}`
			);
			
			// Add important includes
			for (const importantPattern of importantCssIncludes) {
				const importantFiles = await vscode.workspace.findFiles(importantPattern);
				files.push(...importantFiles);
			}
			
			log(`Found ${files.length} CSS files for pattern ${pattern}`);
			
			for (const file of files) {
				try {
					log(`Processing CSS file: ${file.fsPath}`);
					const content = await fs.promises.readFile(file.fsPath, 'utf-8');

					// Process @property rules first
					const propertyMatches = content.matchAll(PROPERTY_RULE_PATTERN);
					let propertyCount = 0;
					for (const match of propertyMatches) {
						const [_, comment, name, body] = match;
						
						// Extract property metadata
						const syntax = body.match(/syntax:\s*['"]([^'"]+)['"]/)?.[1];
						const inherits = body.match(/inherits:\s*(true|false)/)?.[1];
						const initialValue = body.match(/initial-value:\s*([^;]+)/)?.[1];
						
						// Format description with metadata
						const description = [
							comment.trim(),
							'',
							'```css',
							syntax ? `syntax: ${syntax}` : null,
							inherits ? `inherits: ${inherits}` : null,
							initialValue ? `initial-value: ${initialValue}` : null,
							'```'
						].filter(Boolean).join('\n');

						this.variables.set(name, {
							name,
							description,
							source: 'global',
							filePath: file.fsPath
						});
						propertyCount++;
					}
					log(`Extracted ${propertyCount} @property rules from ${file.fsPath}`);

					// Process regular CSS variables
					const matches = content.matchAll(CSS_VAR_PATTERN);
					let varCount = 0;
					for (const match of matches) {
						const [_, comment, declaration] = match;
						const name = declaration.match(/--[\w-]+/)?.[0];
						if (name && !this.variables.has(name)) { // Only add if not already defined as @property
							this.variables.set(name, {
								name,
								description: comment?.trim(),
								source: 'global',
								filePath: file.fsPath
							});
							varCount++;
						}
					}
					log(`Extracted ${varCount} CSS variables from ${file.fsPath}`);
				} catch (error) {
					log(`Error processing file ${file.fsPath}: ${error}`);
				}
			}
		}

		// Process Svelte files
		for (const pattern of sveltePatterns) {
			log(`Searching for Svelte files matching pattern: ${pattern}`);
			const files = await vscode.workspace.findFiles(
				pattern,
				`{${excludePatterns.join(',')}}`
			);
			
			// Add important includes
			for (const importantPattern of importantSvelteIncludes) {
				const importantFiles = await vscode.workspace.findFiles(importantPattern);
				files.push(...importantFiles);
			}
			
			log(`Found ${files.length} Svelte files for pattern ${pattern}`);
			
			for (const file of files) {
				try {
					log(`Processing Svelte file: ${file.fsPath}`);
					const content = await fs.promises.readFile(file.fsPath, 'utf-8');
					const componentName = path.basename(file.fsPath, '.svelte');
					const matches = content.matchAll(CSSPROP_DOC_PATTERN);
					let propCount = 0;
					for (const match of matches) {
						const [_, name, description] = match;
						this.variables.set(name, {
							name,
							description: description.trim(),
							source: 'component',
							componentName,
							filePath: file.fsPath
						});
						propCount++;
					}
					log(`Extracted ${propCount} CSS properties from Svelte component ${componentName}`);
				} catch (error) {
					log(`Error processing file ${file.fsPath}: ${error}`);
				}
			}
		}

		log(`Variable update complete. Total variables: ${this.variables.size}`);
	}

	private async getCurrentComponentImports(document: vscode.TextDocument): Promise<Set<string>> {
		log(`Analyzing component imports for document: ${document.uri.toString()}`);
		const content = document.getText();
		const importPattern = /import\s+{([^}]+)}\s+from\s+['"]lutra['"];?/g;
		const components = new Set<string>();
		
		for (const match of content.matchAll(importPattern)) {
			const imports = match[1].split(',').map(s => s.trim());
			imports.forEach(imp => components.add(imp));
		}
		
		log(`Found imported components: ${Array.from(components).join(', ')}`);
		return components;
	}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position
	): Promise<vscode.CompletionItem[]> {
		log(`Providing completion items at position: line ${position.line + 1}, character ${position.character}`);
		const linePrefix = document.lineAt(position).text.substring(0, position.character);
		
		// Check for various CSS variable patterns:
		// 1. var(- followed by another - (in CSS)
		// 2. standalone -- (direct CSS variable)
		// 3. attribute --prop (in Svelte components)
		const isVarPattern = linePrefix.includes('var(-') && linePrefix.endsWith('-');
		const isDirectPattern = linePrefix.endsWith('--');
		const isSvelteAttributePattern = /\s--$/.test(linePrefix);  // Space followed by --
		
		if (!isVarPattern && !isDirectPattern && !isSvelteAttributePattern) {
			log(`Line prefix "${linePrefix}" does not match completion pattern, skipping completions`);
			return [];
		}

		const importedComponents = await this.getCurrentComponentImports(document);
		
		const completionItems = Array.from(this.variables.values()).filter(variable => {
			// Include global variables and variables from imported components
			return variable.source === 'global' || 
				   	(variable.source === 'component' && 
					variable.componentName && 
					importedComponents.has(variable.componentName));
		}).map(variable => {
			const completionItem = new vscode.CompletionItem(variable.name);
			completionItem.kind = vscode.CompletionItemKind.Variable;
			
			// Create a relative path for display
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(variable.filePath));
			const relativePath = workspaceFolder 
				? path.relative(workspaceFolder.uri.fsPath, variable.filePath)
				: variable.filePath;
			
			if (variable.source === 'component') {
				completionItem.detail = `Lutra • ${variable.componentName} • ${relativePath}`;
				if (variable.description) {
					completionItem.documentation = new vscode.MarkdownString([
						variable.description,
						'',
						'```',
						`Source: ${relativePath}`,
						'```'
					].join('\n'));
				}
			} else {
				completionItem.detail = `Lutra • ${relativePath}`;
				if (variable.description) {
					completionItem.documentation = new vscode.MarkdownString([
						variable.description,
						'',
						'```',
						`Source: ${relativePath}`,
						'```'
					].join('\n'));
				}
			}
			
			// Add closing parenthesis if we're in a var() function
			if (isVarPattern) {
				completionItem.insertText = `${variable.name.substring(2)})`;  // Remove the -- prefix since we already have one -
			} else if (isSvelteAttributePattern) {
				// For Svelte attributes, remove the -- prefix since we're already typing it
				completionItem.insertText = variable.name.substring(2);
			}
			
			return completionItem;
		});

		log(`Returning ${completionItems.length} completion items`);
		return completionItems;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('lutra');
	if (config.get<boolean>('enableLogging', false)) {
		// Only show output channel if logging is enabled
		outputChannel.show(true);
	}
	
	log('🚀 Checking for Lutra package...');
	
	// Check if we have a workspace
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		log('No workspace folders found, extension will not activate');
		return;
	}

	// Check for package.json in the workspace root
	try {
		const packageJsonFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
		let hasLutra = false;

		for (const packageJsonUri of packageJsonFiles) {
			const content = await fs.promises.readFile(packageJsonUri.fsPath, 'utf-8');
			const packageJson = JSON.parse(content);
			
			// Check if this is the lutra package itself or if it has lutra as a dependency
			if (
				packageJson.name === 'lutra' ||
				(packageJson.dependencies && packageJson.dependencies.lutra) ||
				(packageJson.devDependencies && packageJson.devDependencies.lutra)
			) {
				hasLutra = true;
				log(`Found Lutra package in ${packageJsonUri.fsPath}`);
				break;
			}
		}

		if (!hasLutra) {
			log('Neither Lutra package nor Lutra dependency found in package.json, extension will not activate');
			return;
		}
	} catch (error) {
		log(`Error checking for Lutra package: ${error}`);
		return;
	}

	log(`Extension path: ${context.extensionPath}`);
	log(`Workspace folders: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') || 'none'}`);

	try {
		const provider = new CSSVariableCompletionProvider();
		const selector = [
			{ scheme: 'file', language: 'css' },
			{ scheme: 'file', language: 'svelte' }
		];

		log('Registering completion provider...');
		const disposable = vscode.languages.registerCompletionItemProvider(
			selector,
			provider,
			'-'
		);

		context.subscriptions.push(disposable);
		log('✅ Successfully registered completion provider');
		
		// Register commands
		let rescanCommand = vscode.commands.registerCommand('lutra.rescanCSSVariables', async () => {
			log('Manually rescanning CSS variables...');
			await provider.updateVariables();
			vscode.window.showInformationMessage('Lutra: CSS variables rescanned');
			log('Manual rescan complete');
		});

		context.subscriptions.push(rescanCommand);
		
	} catch (error: unknown) {
		if (error instanceof Error) {
			log(`❌ Error during extension activation: ${error.message}`);
			log(error.stack || 'No stack trace available');
		} else {
			log(`❌ Error during extension activation: ${String(error)}`);
		}
		throw error; // Re-throw to ensure VS Code knows about the activation failure
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	log('Deactivating Lutra CSS Variable Completion extension');
}

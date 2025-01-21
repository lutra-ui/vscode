// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// CSS variable pattern to match --variable-name: value;
const CSS_VAR_PATTERN = /(?:\/\*([^*]*)\*\/\s*)?([^}]*?--[\w-]+:\s*[^;]+;)/g;
// Pattern to match @cssprop documentation
const CSSPROP_DOC_PATTERN = /@cssprop\s+(--[\w-]+)\s*-\s*([^\n]+)/g;

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel('Lutra CSS Variables');

function log(message: string) {
	outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
	// Also log to console for debugging
	console.log(`[Lutra] ${message}`);
}

interface CSSVariable {
	name: string;
	description?: string;
	source: 'global' | 'component';
	componentName?: string;
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

	private async updateVariables() {
		log('Starting variable update');
		this.variables.clear();
		
		// Search patterns for CSS files and Svelte components
		const patterns = [
			{ pattern: '**/*.css', type: 'css' },
			{ pattern: '**/node_modules/lutra/**/*.css', type: 'css' },
			{ pattern: '**/node_modules/lutra/**/*.svelte', type: 'svelte' }
		];

		for (const { pattern, type } of patterns) {
			log(`Searching for files matching pattern: ${pattern}`);
			const files = await vscode.workspace.findFiles(
				pattern,
				'**/node_modules/**/node_modules/**'
			);
			
			log(`Found ${files.length} files for pattern ${pattern}`);
			
			for (const file of files) {
				try {
					log(`Processing file: ${file.fsPath}`);
					const content = await fs.promises.readFile(file.fsPath, 'utf-8');
					
					if (type === 'css') {
						const matches = content.matchAll(CSS_VAR_PATTERN);
						let varCount = 0;
						for (const match of matches) {
							const [_, comment, declaration] = match;
							const name = declaration.match(/--[\w-]+/)?.[0];
							if (name) {
								this.variables.set(name, {
									name,
									description: comment?.trim(),
									source: 'global'
								});
								varCount++;
							}
						}
						log(`Extracted ${varCount} CSS variables from ${file.fsPath}`);
					} else if (type === 'svelte') {
						const componentName = path.basename(file.fsPath, '.svelte');
						const matches = content.matchAll(CSSPROP_DOC_PATTERN);
						let propCount = 0;
						for (const match of matches) {
							const [_, name, description] = match;
							this.variables.set(name, {
								name,
								description: description.trim(),
								source: 'component',
								componentName
							});
							propCount++;
						}
						log(`Extracted ${propCount} CSS properties from Svelte component ${componentName}`);
					}
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
			
			if (variable.source === 'component') {
				completionItem.detail = `CSS Property for ${variable.componentName}`;
				completionItem.documentation = new vscode.MarkdownString(variable.description || '');
			} else {
				completionItem.detail = 'Global CSS Variable';
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
	// Force show the output channel
	outputChannel.show(true);
	
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
			
			// Check both dependencies and devDependencies for lutra
			if (
				(packageJson.dependencies && packageJson.dependencies.lutra) ||
				(packageJson.devDependencies && packageJson.devDependencies.lutra)
			) {
				hasLutra = true;
				log(`Found Lutra package in ${packageJsonUri.fsPath}`);
				break;
			}
		}

		if (!hasLutra) {
			log('Lutra package not found in package.json, extension will not activate');
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
		
		// Register the hello world command just to verify activation
		let helloCommand = vscode.commands.registerCommand('lutra.helloWorld', () => {
			vscode.window.showInformationMessage('Hello from Lutra!');
			log('Hello World command executed');
		});
		context.subscriptions.push(helloCommand);
		
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

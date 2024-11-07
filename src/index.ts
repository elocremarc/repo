#!/usr/bin/env bun
import { join } from 'path';
import { readdir, access, stat, readFile } from 'fs/promises';
import pc from 'picocolors';
import clipboardy from 'clipboardy';
import enquirer from 'enquirer';

interface FileInfo {
  path: string;
  content: string;
  type: 'file' | 'directory' | 'ignored' | 'binary' | 'unreadable';
}

// Helper function to check if content appears to be binary
function isBinaryContent(content: string): boolean {
  // Check for null bytes or high concentration of non-printable characters
  const nonPrintable = content
    .slice(0, 1000)
    .match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
  return nonPrintable !== null && nonPrintable.length > 10;
}

async function getRepoStructure(
  dir: string,
  relativePath: string = '',
  ignore: string[] = ['.git', 'node_modules', 'dist', 'build']
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  const entries = await readdir(join(dir, relativePath), {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const path = join(relativePath, entry.name);

    // Mark ignored directories but don't traverse them
    if (ignore.includes(entry.name)) {
      results.push({ path, content: '', type: 'ignored' });
      continue;
    }

    if (entry.isDirectory()) {
      results.push({ path, content: '', type: 'directory' });
      results.push(...(await getRepoStructure(dir, path, ignore)));
    } else {
      const filePath = join(dir, path);
      try {
        const content = await readFile(filePath, 'utf-8');

        // Mark binary files but include them in structure
        if (isBinaryContent(content)) {
          results.push({ path, content: '', type: 'binary' });
          continue;
        }

        results.push({ path, content, type: 'file' });
      } catch (error) {
        results.push({ path, content: '', type: 'unreadable' });
      }
    }
  }

  return results;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  fileType: 'file' | 'directory' | 'ignored' | 'binary' | 'unreadable';
  children?: TreeNode[];
}

function buildTree(files: FileInfo[]): TreeNode[] {
  const pathMap: { [key: string]: TreeNode } = {};
  const roots: TreeNode[] = [];

  for (const file of files) {
    // Remove the line that skips ignored files
    // if (['ignored', 'binary', 'unreadable'].includes(file.type)) continue;

    const parts = file.path.split('/');
    let currentPath = '';
    let parentNode: TreeNode | undefined;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!pathMap[currentPath]) {
        const node: TreeNode = {
          name: part,
          path: currentPath,
          type: 'directory',
          fileType: 'directory',
          children: [],
        };
        pathMap[currentPath] = node;

        if (parentNode) {
          parentNode.children!.push(node);
        } else {
          roots.push(node);
        }
      }

      parentNode = pathMap[currentPath];
    }

    // Set the node's type and fileType
    pathMap[currentPath]!.type =
      file.type === 'directory' ? 'directory' : 'file';
    pathMap[currentPath]!.fileType = file.type;
    if (file.type !== 'directory') {
      delete pathMap[currentPath]!.children;
    }
  }

  return roots;
}

async function promptSelection(tree: TreeNode[]): Promise<string[]> {
  const choices = treeToChoices(tree);
  const response = await enquirer.prompt<{ selectedFiles: string[] }>({
    type: 'multiselect',
    name: 'selectedFiles',
    message: 'Copy to clipboard:',
    choices,
  });
  return response.selectedFiles;
}

function treeToChoices(nodes: TreeNode[], indent = ''): any[] {
  const choices: any[] = [];
  for (const node of nodes) {
    const icon = node.type === 'directory' ? '📁' : '📄';
    let status = '';
    let disabled = false;

    if (node.fileType === 'ignored') {
      status = '(ignored)';
      disabled = true;
    } else if (node.fileType === 'binary') {
      status = '(binary)';
      disabled = true;
    } else if (node.fileType === 'unreadable') {
      status = '(unreadable)';
      disabled = true;
    }

    const displayName = `${indent}${icon} ${node.name} ${status}`;

    if (node.type === 'directory') {
      choices.push({
        name: node.path,
        message: displayName,
        role: 'heading', // Directory as heading
      });
    } else {
      choices.push({
        name: node.path,
        message: displayName,
        value: node.path, // File is selectable
        disabled, // Disable unselectable files
      });
    }

    if (node.children) {
      choices.push(...treeToChoices(node.children, indent + '  '));
    }
  }
  return choices;
}

async function main() {
  const args = process.argv.slice(2);
  const targetDir = args[0] || process.cwd();
  const specifiedFiles = args.slice(1); // Extract specified files from command-line arguments

  try {
    await access(targetDir);
  } catch {
    console.error(pc.red(`Directory ${targetDir} does not exist`));
    process.exit(1);
  }

  console.log(pc.cyan(`📂 Analyzing repo: ${targetDir}\n`));

  try {
    let files: FileInfo[];

    if (specifiedFiles.length > 0) {
      // Only look at the specified files
      files = await getSpecifiedFiles(targetDir, specifiedFiles);
    } else {
      // Existing code to get all files
      files = await getRepoStructure(targetDir);
    }

    let selectedFiles: FileInfo[];

    if (specifiedFiles.length > 0) {
      // Use the specified files as selected files
      selectedFiles = files;
    } else {
      const tree = buildTree(files);
      const selectedPaths = await promptSelection(tree);

      // Filter the files based on selection
      selectedFiles = files.filter((file) => selectedPaths.includes(file.path));
    }

    const markdownStructure = generateMarkdownStructure(selectedFiles);
    const allContents =
      `${markdownStructure}\n\n# File Contents\n\n` +
      selectedFiles
        .filter((file) => file.type === 'file')
        .map((file) => `## ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
        .join('\n\n');

    try {
      await clipboardy.write(allContents);
      console.log(pc.green('\n✓ Repository contents copied to clipboard!'));
      console.log('\nRepository structure:');

      // Show complete structure with status indicators
      files.forEach((file) => {
        const indent = '  '.repeat(file.path.split('/').length - 1);
        const isSelected = selectedPaths.includes(file.path);
        const icon = file.type === 'directory' ? '📁' : '📄';

        let displayPath = `${indent}${icon} ${file.path}`;
        let status = '';

        if (file.type === 'ignored') {
          status = '(ignored)';
        } else if (file.type === 'binary') {
          status = '(binary)';
        } else if (file.type === 'unreadable') {
          status = '(unreadable)';
        }

        if (isSelected) {
          console.log(pc.green(`${displayPath} ✓ ${status}`));
        } else {
          console.log(pc.dim(`${displayPath} ✗ ${status}`));
        }
      });
    } catch (error) {
      console.error(pc.red('Failed to copy to clipboard:'), error);
    }
  } catch (error) {
    console.error(pc.red('Error analyzing repository:'), error);
    process.exit(1);
  }
}

function generateMarkdownStructure(files: FileInfo[]): string {
  let markdown = '# Repository Structure\n\n';

  files.forEach((file) => {
    const indent = '  '.repeat(file.path.split('/').length - 1);
    const icon = file.type === 'directory' ? '📁' : '📄';
    markdown += `${indent}- ${icon} ${file.path}\n`;
  });

  return markdown;
}

// Add a new helper function to get the specified files
async function getSpecifiedFiles(
  dir: string,
  filePaths: string[]
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];

  for (const relativePath of filePaths) {
    const filePath = join(dir, relativePath);

    try {
      const fileStat = await stat(filePath);

      if (fileStat.isDirectory()) {
        // If a directory is specified, get its structure
        const dirFiles = await getRepoStructure(dir, relativePath);
        results.push(...dirFiles);
      } else {
        // It's a file
        const content = await readFile(filePath, 'utf-8');

        // Check if it's binary
        if (isBinaryContent(content)) {
          results.push({ path: relativePath, content: '', type: 'binary' });
        } else {
          results.push({ path: relativePath, content, type: 'file' });
        }
      }
    } catch (error) {
      results.push({ path: relativePath, content: '', type: 'unreadable' });
    }
  }

  return results;
}

main();

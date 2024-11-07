#!/usr/bin/env bun
import { join, isAbsolute, relative, resolve } from 'path';
import { readdir, access, stat, readFile } from 'fs/promises';
import pc from 'picocolors';
import clipboardy from 'clipboardy';
import enquirer from 'enquirer';

interface FileInfo {
  path: string; // Relative path to targetDir
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
  const fullPath = join(dir, relativePath);
  let entries: fs.Dirent[];

  try {
    entries = await readdir(fullPath, { withFileTypes: true });
  } catch (error) {
    console.error(pc.red(`Failed to read directory: ${fullPath}`), error);
    return results;
  }

  for (const entry of entries) {
    const entryPath = join(relativePath, entry.name);

    // Mark ignored directories but don't traverse them
    if (ignore.includes(entry.name)) {
      results.push({ path: entryPath, content: '', type: 'ignored' });
      continue;
    }

    if (entry.isDirectory()) {
      results.push({ path: entryPath, content: '', type: 'directory' });
      results.push(...(await getRepoStructure(dir, entryPath, ignore)));
    } else {
      const filePath = join(dir, entryPath);
      try {
        const content = await readFile(filePath, 'utf-8');

        // Mark binary files but include them in structure
        if (isBinaryContent(content)) {
          results.push({ path: entryPath, content: '', type: 'binary' });
          continue;
        }

        results.push({ path: entryPath, content, type: 'file' });
      } catch (error) {
        results.push({ path: entryPath, content: '', type: 'unreadable' });
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
    message: 'Select files to copy to clipboard:',
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

  // Parse arguments to detect '--all' flag
  const allFlagIndex = args.indexOf('--all');
  const selectAll = allFlagIndex !== -1;

  // Remove '--all' from args to get specified files
  if (selectAll) {
    args.splice(allFlagIndex, 1);
  }

  let targetDir: string;
  let specifiedFiles: string[];

  if (args.length > 0) {
    const firstArg = args[0];
    const firstArgPath = isAbsolute(firstArg)
      ? firstArg
      : resolve(process.cwd(), firstArg);

    try {
      const pathStat = await stat(firstArgPath);
      if (pathStat.isDirectory()) {
        // First argument is a directory
        targetDir = firstArgPath;
        specifiedFiles = args.slice(1);
      } else {
        // First argument is a file
        targetDir = process.cwd();
        specifiedFiles = args;
      }
    } catch (error) {
      console.error(pc.red(`Path "${firstArg}" does not exist.`));
      process.exit(1);
    }
  } else {
    // No arguments provided
    targetDir = process.cwd();
    specifiedFiles = [];
  }

  try {
    await access(targetDir);
  } catch {
    console.error(
      pc.red(`Directory "${targetDir}" does not exist or is inaccessible.`)
    );
    process.exit(1);
  }

  console.log(pc.cyan(`📂 Analyzing repo: ${targetDir}\n`));

  try {
    let files: FileInfo[];

    if (selectAll) {
      // If '--all' is passed, select all files
      files = await getRepoStructure(targetDir);
    } else if (specifiedFiles.length > 0) {
      // Only look at the specified files
      files = await getSpecifiedFiles(targetDir, specifiedFiles);
    } else {
      // Existing code to get all files with interactive selection
      files = await getRepoStructure(targetDir);
    }

    let selectedFiles: FileInfo[];

    if (selectAll) {
      // All files are selected
      selectedFiles = files;
    } else if (specifiedFiles.length > 0) {
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
        const isSelected = selectAll || specifiedFiles.includes(file.path);
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

// Helper function to get specified files
async function getSpecifiedFiles(
  dir: string,
  filePaths: string[]
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];

  for (const inputPath of filePaths) {
    // Resolve the absolute path
    const absolutePath = isAbsolute(inputPath)
      ? inputPath
      : resolve(dir, inputPath);

    // Ensure the specified file is within the target directory
    const relativePath = relative(dir, absolutePath);
    if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
      console.error(
        pc.red(
          `Error: Specified file "${inputPath}" is outside the target directory.`
        )
      );
      results.push({ path: inputPath, content: '', type: 'unreadable' });
      continue;
    }

    try {
      const fileStat = await stat(absolutePath);

      if (fileStat.isDirectory()) {
        // If a directory is specified, get its structure
        const dirFiles = await getRepoStructure(dir, relativePath);
        results.push(...dirFiles);
      } else {
        // It's a file
        let content = '';
        try {
          content = await readFile(absolutePath, 'utf-8'); // Corrected line with closing parenthesis

          // Check if it's binary
          if (isBinaryContent(content)) {
            results.push({ path: relativePath, content: '', type: 'binary' });
            continue;
          }

          results.push({ path: relativePath, content, type: 'file' });
        } catch (readError) {
          console.error(pc.red(`Error: Unable to read file "${inputPath}".`));
          results.push({ path: relativePath, content: '', type: 'unreadable' });
        }
      }
    } catch (error) {
      console.error(
        pc.red(
          `Error: Specified path "${inputPath}" does not exist or is inaccessible.`
        )
      );
      results.push({ path: inputPath, content: '', type: 'unreadable' });
    }
  }

  return results;
}

main();

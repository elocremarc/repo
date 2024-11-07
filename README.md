# Repo-to-Text CLI Tool

A simple CLI tool that outputs repository code and structure as a single string, perfect for pasting into LLMs. The output will be automatically copied to your clipboard.

## Installation

Install the tool globally using **Bun**:

```bash
bun link
```

This will link the package globally, allowing you to run the `repo` command anywhere.

## Usage

Navigate to your repository directory and run:

```bash
repo
```

This will analyze the current directory, prompt you to select files or directories to include, and copy the markdown-formatted representation to your clipboard.

### Options

- **Select All Files**: To include all files without prompting, use the `--all` flag:

  ```bash
  repo --all
  ```

- **Specify Files or Directories**: You can specify particular files or directories to include:

  ```bash
  repo src/index.ts README.md
  ```

  This will include only `src/index.ts` and `README.md` in the output.

## Example

Running the tool in your repository:

```bash
repo
```

Sample output:

```
📂 Analyzing repo: /path/to/your/repo

✓ Repository contents copied to clipboard!

Repository structure:
📁 src ✓
  📄 src/index.ts ✓
📄 README.md ✓
```

The markdown content copied to your clipboard will include the repository structure and the contents of the selected files, ready to be pasted into an LLM or any text-based interface.

## Notes

- **Ignored Directories**: By default, the tool ignores common build and dependency directories such as `.git`, `node_modules`, `dist`, and `build`.
- **Binary and Unreadable Files**: Binary files and files that cannot be read are marked accordingly and skipped.
- **Interactive Selection**: If no files or the `--all` flag are not specified, the tool will prompt you to select files to include.

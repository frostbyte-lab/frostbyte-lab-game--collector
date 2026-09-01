/**
 * Dependency Graph Tool
 * Visualize dan analyze dependency relationships
 * - Build dependency tree
 * - Detect circular dependencies
 * - Identify unused imports
 * - Generate dependency report
 */

export class DependencyGraphTool {
  constructor(zipFS, manifest) {
    this.zipFS = zipFS;
    this.manifest = manifest;
    this.graph = new Map();
    this.nodes = new Map();
    this.unresolvedDeps = [];
  }

  /**
   * Build dependency graph lengkap
   */
  async buildGraph() {
    console.log('[DependencyGraphTool] Building dependency graph...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs') || 
      a.path?.endsWith('.ts') || a.path?.endsWith('.tsx')
    ) || [];

    // First pass: create all nodes
    for (const file of jsFiles) {
      this.nodes.set(file.path, {
        path: file.path,
        imports: [],
        exports: [],
        dependents: [],
        size: file.size || 0
      });
    }

    // Second pass: build edges
    for (const file of jsFiles) {
      await this.extractDependencies(file.path);
    }

    return this.generateGraphAnalysis();
  }

  /**
   * Extract dependencies dari file
   */
  async extractDependencies(filePath) {
    try {
      const content = await this.zipFS.readFile(filePath, 'utf-8');
      const node = this.nodes.get(filePath);
      
      if (!node) return;

      // Find ES6 imports
      const esImportRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      
      while ((match = esImportRegex.exec(content)) !== null) {
        const importPath = this.resolveImportPath(match[1], filePath);
        node.imports.push({
          original: match[1],
          resolved: importPath,
          type: 'es6-import'
        });

        if (this.nodes.has(importPath)) {
          this.nodes.get(importPath).dependents.push(filePath);
        } else {
          this.unresolvedDeps.push({
            from: filePath,
            to: importPath,
            type: 'missing'
          });
        }
      }

      // Find CommonJS requires
      const requireRegex = /require\s*\(\s+['"]([^'"]+)['"]\s*\)/g;
      
      while ((match = requireRegex.exec(content)) !== null) {
        const importPath = this.resolveImportPath(match[1], filePath);
        node.imports.push({
          original: match[1],
          resolved: importPath,
          type: 'commonjs-require'
        });

        if (this.nodes.has(importPath)) {
          this.nodes.get(importPath).dependents.push(filePath);
        } else {
          this.unresolvedDeps.push({
            from: filePath,
            to: importPath,
            type: 'missing'
          });
        }
      }

      // Find dynamic imports
      const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      
      while ((match = dynamicImportRegex.exec(content)) !== null) {
        const importPath = this.resolveImportPath(match[1], filePath);
        node.imports.push({
          original: match[1],
          resolved: importPath,
          type: 'dynamic-import'
        });
      }
    } catch (err) {
      console.error(`Error extracting dependencies from ${filePath}:`, err.message);
    }
  }

  /**
   * Resolve import path ke actual file
   */
  resolveImportPath(importPath, fromFile) {
    const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));
    
    // Resolve relative paths
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      let resolvedPath = importPath;
      if (importPath.startsWith('./')) {
        resolvedPath = fromDir + '/' + importPath.substring(2);
      } else if (importPath.startsWith('../')) {
        const parts = fromDir.split('/');
        parts.pop();
        resolvedPath = parts.join('/') + '/' + importPath.substring(3);
      }

      // Normalize path
      const pathParts = resolvedPath.split('/');
      const normalized = [];
      for (const part of pathParts) {
        if (part === '..' && normalized.length > 0) {
          normalized.pop();
        } else if (part !== '.') {
          normalized.push(part);
        }
      }
      resolvedPath = normalized.join('/');

      // Try with extensions
      for (const ext of ['.js', '.mjs', '.ts', '/index.js', '/index.mjs']) {
        if (this.manifest.assets?.some(a => a.path === resolvedPath + ext)) {
          return resolvedPath + ext;
        }
      }

      return resolvedPath;
    }

    // Handle node_modules and external packages
    if (!importPath.startsWith('/')) {
      return `node_modules/${importPath}`;
    }

    return importPath;
  }

  /**
   * Detect circular dependencies
   */
  findCircularDependencies() {
    const cycles = [];
    const visited = new Set();
    const recStack = new Set();

    const dfs = (node, path = []) => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const nodeData = this.nodes.get(node);
      if (!nodeData) return;

      for (const dep of nodeData.imports) {
        const resolved = dep.resolved;
        
        if (!visited.has(resolved) && this.nodes.has(resolved)) {
          dfs(resolved, [...path]);
        } else if (recStack.has(resolved)) {
          cycles.push({
            cycle: [...path, resolved],
            length: path.length + 1,
            severity: path.length > 3 ? 'HIGH' : 'MEDIUM'
          });
        }
      }

      recStack.delete(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Identify unused imports
   */
  findUnusedImports() {
    const unused = [];

    for (const [path, node] of this.nodes) {
      try {
        // This would require scanning the actual content for usage
        // Simplified version: flag imports that are never the dependent of anyone
        for (const imp of node.imports) {
          if (this.nodes.has(imp.resolved)) {
            const importedNode = this.nodes.get(imp.resolved);
            if (importedNode.dependents.length === 1 && importedNode.dependents[0] === path) {
              unused.push({
                file: path,
                import: imp.original,
                resolved: imp.resolved,
                type: imp.type
              });
            }
          }
        }
      } catch (err) {
        // Skip
      }
    }

    return unused;
  }

  /**
   * Generate graph analysis
   */
  generateGraphAnalysis() {
    const cycles = this.findCircularDependencies();
    const unused = this.findUnusedImports();

    return {
      timestamp: new Date().toISOString(),
      summary: {
        total_nodes: this.nodes.size,
        total_edges: Array.from(this.nodes.values()).reduce((sum, n) => sum + n.imports.length, 0),
        circular_dependencies: cycles.length,
        unresolved_imports: this.unresolvedDeps.length,
        unused_imports: unused.length
      },
      statistics: this.calculateStatistics(),
      circular_dependencies: cycles,
      unresolved_imports: this.unresolvedDeps,
      unused_imports: unused,
      graph: this.serializeGraph(),
      visualization_data: this.generateVisualizationData(),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Calculate graph statistics
   */
  calculateStatistics() {
    let deepestPath = 0;
    let mostDependents = 0;
    let mostImports = 0;
    let criticalFiles = [];

    for (const [path, node] of this.nodes) {
      if (node.dependents.length > mostDependents) {
        mostDependents = node.dependents.length;
      }
      if (node.imports.length > mostImports) {
        mostImports = node.imports.length;
      }

      // Files with many dependents are critical
      if (node.dependents.length > 5) {
        criticalFiles.push({
          file: path,
          dependents_count: node.dependents.length
        });
      }
    }

    return {
      average_imports_per_file: (Array.from(this.nodes.values())
        .reduce((sum, n) => sum + n.imports.length, 0) / this.nodes.size).toFixed(2),
      average_dependents_per_file: (Array.from(this.nodes.values())
        .reduce((sum, n) => sum + n.dependents.length, 0) / this.nodes.size).toFixed(2),
      most_imported_file: criticalFiles[0] || null,
      deepest_dependency_chain: deepestPath,
      critical_files: criticalFiles.slice(0, 10)
    };
  }

  /**
   * Serialize graph ke format JSON
   */
  serializeGraph() {
    const graphObj = {};
    
    for (const [path, node] of this.nodes) {
      graphObj[path] = {
        imports: node.imports.map(i => ({
          name: i.original,
          resolved: i.resolved,
          type: i.type
        })),
        importedBy: node.dependents
      };
    }

    return graphObj;
  }

  /**
   * Generate data untuk visualization
   */
  generateVisualizationData() {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    // Create nodes
    let id = 0;
    for (const path of this.nodes.keys()) {
      nodeMap.set(path, id);
      nodes.push({
        id: id,
        label: path.split('/').pop(),
        fullPath: path,
        size: this.nodes.get(path).size
      });
      id++;
    }

    // Create edges
    for (const [path, node] of this.nodes) {
      for (const imp of node.imports) {
        if (nodeMap.has(imp.resolved)) {
          edges.push({
            from: nodeMap.get(path),
            to: nodeMap.get(imp.resolved),
            type: imp.type
          });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Generate recommendations
   */
  generateRecommendations() {
    const cycles = this.findCircularDependencies();
    const unused = this.findUnusedImports();
    const recommendations = [];

    if (cycles.length > 0) {
      recommendations.push({
        type: 'circular_dependency',
        severity: 'HIGH',
        count: cycles.length,
        message: `Found ${cycles.length} circular dependency chains`,
        action: 'Refactor modules to remove circular imports'
      });
    }

    if (this.unresolvedDeps.length > 0) {
      recommendations.push({
        type: 'missing_dependencies',
        severity: 'HIGH',
        count: this.unresolvedDeps.length,
        message: `${this.unresolvedDeps.length} imports cannot be resolved`,
        action: 'Check if dependencies are installed or paths are correct'
      });
    }

    if (unused.length > 0) {
      recommendations.push({
        type: 'unused_imports',
        severity: 'LOW',
        count: unused.length,
        message: `Found ${unused.length} unused imports`,
        action: 'Remove unused imports to reduce bundle size'
      });
    }

    if (cycles.length === 0 && this.unresolvedDeps.length === 0) {
      recommendations.push({
        type: 'healthy_dependency_graph',
        severity: 'GOOD',
        message: 'Dependency graph is healthy',
        action: 'Ready for offline bundling'
      });
    }

    return recommendations;
  }
}

export default DependencyGraphTool;
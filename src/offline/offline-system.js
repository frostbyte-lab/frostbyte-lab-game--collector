/**
 * Complete Offline System Integration
 * Menggabungkan semua modul untuk mode offline lengkap
 */

import BugDetector from '../analyze/bug-detector.js';
import SecurityScanner from '../analyze/security-scanner.js';
import DependencyGraphTool from '../analyze/dependency-graph.js';
import OfflineMockGenerator from '../repair/mock-generator.js';

export class CompleteOfflineSystem {
  constructor(zipFS, manifest) {
    this.zipFS = zipFS;
    this.manifest = manifest;
    this.bugDetector = new BugDetector(zipFS, manifest);
    this.securityScanner = new SecurityScanner(zipFS, manifest);
    this.dependencyGraph = new DependencyGraphTool(zipFS, manifest);
    this.mockGenerator = new OfflineMockGenerator(zipFS, manifest);
  }

  /**
   * Jalankan analisis lengkap
   */
  async analyzeForOffline() {
    console.log('[CompleteOfflineSystem] Starting comprehensive offline analysis...');
    
    const analysis = await Promise.all([
      this.bugDetector.detectAll(),
      this.securityScanner.scanAll(),
      this.dependencyGraph.buildGraph(),
      this.mockGenerator.generateAllMocks()
    ]);

    return {
      timestamp: new Date().toISOString(),
      status: this.determineOfflineReadiness(analysis),
      bug_report: analysis[0],
      security_report: analysis[1],
      dependency_analysis: analysis[2],
      mock_generation: analysis[3],
      summary: this.generateSummary(analysis),
      offline_readiness_score: this.calculateOfflineScore(analysis),
      action_plan: this.generateActionPlan(analysis)
    };
  }

  /**
   * Tentukan kesiapan offline
   */
  determineOfflineReadiness(analysis) {
    const bugReport = analysis[0];
    const securityReport = analysis[1];
    const depAnalysis = analysis[2];

    const criticalBugs = bugReport.bugs.filter(b => b.severity === 'CRITICAL').length;
    const criticalVulns = securityReport.vulnerabilities.filter(v => v.severity === 'CRITICAL').length;
    const circularDeps = depAnalysis.summary.circular_dependencies;

    if (criticalBugs > 0 || criticalVulns > 0) {
      return {
        status: 'BLOCKED',
        reason: 'Critical issues must be fixed',
        details: `${criticalBugs} critical bugs, ${criticalVulns} critical vulnerabilities`
      };
    }

    if (circularDeps > 0) {
      return {
        status: 'NEEDS_FIXING',
        reason: 'Circular dependencies detected',
        details: `${circularDeps} circular dependency chains found`
      };
    }

    return {
      status: 'READY_FOR_OFFLINE',
      reason: 'Game appears ready for offline mode',
      details: 'All critical checks passed'
    };
  }

  /**
   * Generate summary
   */
  generateSummary(analysis) {
    return {
      bugs: {
        total: analysis[0].bugs.length,
        critical: analysis[0].bugs.filter(b => b.severity === 'CRITICAL').length,
        high: analysis[0].bugs.filter(b => b.severity === 'HIGH').length
      },
      security: {
        score: analysis[1].security_score,
        vulnerabilities: analysis[1].vulnerabilities.length,
        critical: analysis[1].vulnerabilities.filter(v => v.severity === 'CRITICAL').length
      },
      dependencies: {
        total_files: analysis[2].summary.total_nodes,
        circular: analysis[2].summary.circular_dependencies,
        unresolved: analysis[2].summary.unresolved_imports
      },
      mocks: {
        api_endpoints: Object.keys(analysis[3].api_mocks || {}).length,
        data_structures: Object.keys(analysis[3].data_mocks || {}).length
      }
    };
  }

  /**
   * Calculate offline readiness score (0-100)
   */
  calculateOfflineScore(analysis) {
    let score = 100;

    // Bug impact
    score -= analysis[0].bugs.filter(b => b.severity === 'CRITICAL').length * 20;
    score -= analysis[0].bugs.filter(b => b.severity === 'HIGH').length * 10;
    score -= analysis[0].bugs.filter(b => b.severity === 'MEDIUM').length * 3;

    // Security impact
    score -= analysis[1].vulnerabilities.filter(v => v.severity === 'CRITICAL').length * 20;
    score -= analysis[1].vulnerabilities.filter(v => v.severity === 'HIGH').length * 8;

    // Dependency impact
    score -= analysis[2].summary.circular_dependencies * 5;
    score -= Math.min(analysis[2].summary.unresolved_imports, 10) * 3;

    return Math.max(0, score);
  }

  /**
   * Generate detailed action plan
   */
  generateActionPlan(analysis) {
    const plan = {
      phase_1_critical_fixes: [],
      phase_2_security_hardening: [],
      phase_3_dependency_cleanup: [],
      phase_4_offline_testing: [],
      phase_5_deployment: []
    };

    // Phase 1: Critical Fixes
    const criticalBugs = analysis[0].bugs.filter(b => b.severity === 'CRITICAL');
    if (criticalBugs.length > 0) {
      plan.phase_1_critical_fixes.push({
        task: 'Fix Critical Bugs',
        description: `Address ${criticalBugs.length} critical bugs identified`,
        bugs: criticalBugs.slice(0, 5)
      });
    }

    // Phase 2: Security
    const criticalVulns = analysis[1].vulnerabilities.filter(v => v.severity === 'CRITICAL');
    if (criticalVulns.length > 0) {
      plan.phase_2_security_hardening.push({
        task: 'Remove Credentials',
        description: `Remove ${criticalVulns.length} hardcoded credentials`,
        vulnerabilities: criticalVulns.slice(0, 5)
      });
    }

    // Phase 3: Dependencies
    if (analysis[2].summary.circular_dependencies > 0) {
      plan.phase_3_dependency_cleanup.push({
        task: 'Resolve Circular Dependencies',
        description: `Refactor ${analysis[2].summary.circular_dependencies} circular imports`,
        cycles: analysis[2].circular_dependencies.slice(0, 3)
      });
    }

    // Phase 4: Testing
    plan.phase_4_offline_testing.push({
      task: 'Test Offline Mode',
      description: 'Verify all mocked endpoints work correctly',
      test_items: [
        'Test all API endpoints with mocks',
        'Verify state persistence',
        'Test network failure scenarios',
        'Validate asset loading offline'
      ]
    });

    // Phase 5: Deployment
    plan.phase_5_deployment.push({
      task: 'Package & Deploy',
      description: 'Create offline package and deploy',
      steps: [
        'Generate final ZIP with all assets',
        'Include offline service worker',
        'Package state manager and mocks',
        'Test on target devices',
        'Deploy to offline platforms'
      ]
    });

    return plan;
  }

  /**
   * Export analysis results
   */
  async exportResults(analysis) {
    return {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      game_info: {
        files_analyzed: this.manifest.assets?.length || 0,
        total_size: this.calculateTotalSize(),
        detected_engine: this.detectGameEngine()
      },
      complete_analysis: analysis,
      export_format: 'JSON',
      ready_for_offline: analysis.status.status === 'READY_FOR_OFFLINE'
    };
  }

  /**
   * Helper: Calculate total size
   */
  calculateTotalSize() {
    return (this.manifest.assets || []).reduce((sum, a) => sum + (a.size || 0), 0);
  }

  /**
   * Helper: Detect game engine
   */
  detectGameEngine() {
    const assets = (this.manifest.assets || []).map(a => a.path.toLowerCase());
    
    if (assets.some(a => a.includes('phaser'))) return 'Phaser';
    if (assets.some(a => a.includes('pixi'))) return 'Pixi.js';
    if (assets.some(a => a.includes('unity'))) return 'Unity';
    if (assets.some(a => a.includes('construct'))) return 'Construct';
    if (assets.some(a => a.includes('cocos'))) return 'Cocos';
    
    return 'Unknown';
  }
}

export default CompleteOfflineSystem;
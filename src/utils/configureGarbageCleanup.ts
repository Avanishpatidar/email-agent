#!/usr/bin/env node

/**
 * Garbage Email Cleanup Configuration Utility
 * This script helps you safely configure the garbage cleanup feature
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const settingsPath = path.join(process.cwd(), 'src/config/settings.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function loadCurrentSettings() {
  try {
    const content = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ Error loading settings:', error);
    process.exit(1);
  }
}

function saveSettings(settings: any) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('✅ Settings saved successfully!');
  } catch (error) {
    console.error('❌ Error saving settings:', error);
    process.exit(1);
  }
}

async function main() {
  console.log('🗑️  GARBAGE EMAIL CLEANUP CONFIGURATION');
  console.log('=====================================\n');

  const settings = await loadCurrentSettings();
  const currentGarbageSettings = settings.garbageCleanup;

  console.log('Current settings:');
  console.log(`  Enabled: ${currentGarbageSettings.enabled ? '✅ YES' : '❌ NO'}`);
  console.log(`  Confidence Threshold: ${currentGarbageSettings.confidenceThreshold}%`);
  console.log(`  Max Emails to Analyze: ${currentGarbageSettings.maxEmailsToAnalyze}`);
  console.log(`  Dry Run Mode: ${currentGarbageSettings.dryRunMode ? '✅ YES' : '❌ NO'}`);
  console.log(`  Safety Mode: ${currentGarbageSettings.safetyMode}`);
  console.log(`  Backup Before Delete: ${currentGarbageSettings.backupBeforeDelete ? '✅ YES' : '❌ NO'}\n`);

  const action = await question('What would you like to do?\n' +
    '1. Enable garbage cleanup (safe mode)\n' +
    '2. Disable garbage cleanup\n' +
    '3. Configure advanced settings\n' +
    '4. View current configuration\n' +
    '5. Exit\n' +
    'Enter choice (1-5): ');

  switch (action.trim()) {
    case '1':
      await enableGarbageCleanup(settings);
      break;
    case '2':
      await disableGarbageCleanup(settings);
      break;
    case '3':
      await configureAdvancedSettings(settings);
      break;
    case '4':
      await showCurrentConfiguration(settings);
      break;
    case '5':
      console.log('👋 Goodbye!');
      break;
    default:
      console.log('❌ Invalid choice. Please try again.');
      await main();
  }

  rl.close();
}

async function enableGarbageCleanup(settings: any) {
  console.log('\n🔧 Enabling Garbage Cleanup (Safe Mode)...\n');
  
  const confirm = await question('⚠️  IMPORTANT SAFETY NOTICE:\n' +
    '• This feature will analyze emails for potential garbage/spam\n' +
    '• It uses ultra-conservative detection to protect important emails\n' +
    '• Dry run mode is enabled by default (no actual deletions)\n' +
    '• All emails are backed up before deletion\n' +
    '• You can review what would be deleted before enabling actual deletion\n\n' +
    'Do you want to enable garbage cleanup? (y/N): ');

  if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
    settings.garbageCleanup.enabled = true;
    settings.garbageCleanup.dryRunMode = true; // Always start in dry run mode
    settings.garbageCleanup.confidenceThreshold = 85; // High threshold for safety
    settings.garbageCleanup.safetyMode = 'ultra-conservative';
    settings.garbageCleanup.backupBeforeDelete = true;
    
    saveSettings(settings);
    
    console.log('\n✅ Garbage cleanup enabled in SAFE MODE!');
    console.log('📋 Configuration:');
    console.log('  • Dry run mode: ENABLED (no actual deletions)');
    console.log('  • Confidence threshold: 85% (very high)');
    console.log('  • Safety mode: Ultra-conservative');
    console.log('  • Backup before delete: ENABLED');
    console.log('\n💡 Tip: Run your email agent to see what would be deleted.');
    console.log('   Once you are satisfied, you can disable dry run mode.');
  } else {
    console.log('❌ Garbage cleanup not enabled.');
  }
}

async function disableGarbageCleanup(settings: any) {
  console.log('\n🔧 Disabling Garbage Cleanup...\n');
  
  settings.garbageCleanup.enabled = false;
  saveSettings(settings);
  
  console.log('✅ Garbage cleanup disabled.');
}

async function configureAdvancedSettings(settings: any) {
  console.log('\n🔧 Advanced Configuration...\n');
  
  const currentSettings = settings.garbageCleanup;
  
  console.log('Current advanced settings:');
  Object.entries(currentSettings).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  
  const confirmAdvanced = await question('\n⚠️  WARNING: Advanced configuration can be dangerous.\n' +
    'Only proceed if you understand the risks.\n' +
    'Continue? (y/N): ');
  
  if (confirmAdvanced.toLowerCase() === 'y' || confirmAdvanced.toLowerCase() === 'yes') {
    // Confidence threshold
    const confidenceStr = await question(`\nConfidence threshold (50-100, current: ${currentSettings.confidenceThreshold}): `);
    const confidence = parseInt(confidenceStr.trim());
    if (confidence >= 50 && confidence <= 100) {
      settings.garbageCleanup.confidenceThreshold = confidence;
    }
    
    // Max emails to analyze
    const maxEmailsStr = await question(`Max emails to analyze per run (5-100, current: ${currentSettings.maxEmailsToAnalyze}): `);
    const maxEmails = parseInt(maxEmailsStr.trim());
    if (maxEmails >= 5 && maxEmails <= 100) {
      settings.garbageCleanup.maxEmailsToAnalyze = maxEmails;
    }
    
    // Dry run mode
    const dryRunStr = await question(`Enable dry run mode? (y/N, current: ${currentSettings.dryRunMode}): `);
    settings.garbageCleanup.dryRunMode = dryRunStr.toLowerCase() === 'y' || dryRunStr.toLowerCase() === 'yes';
    
    // Safety mode
    const safetyModeStr = await question(`Safety mode (ultra-conservative/conservative/normal, current: ${currentSettings.safetyMode}): `);
    if (['ultra-conservative', 'conservative', 'normal'].includes(safetyModeStr.trim())) {
      settings.garbageCleanup.safetyMode = safetyModeStr.trim();
    }
    
    saveSettings(settings);
    console.log('\n✅ Advanced settings updated!');
    
    if (!settings.garbageCleanup.dryRunMode) {
      console.log('\n⚠️  WARNING: Dry run mode is disabled. Emails will be actually deleted!');
    }
  } else {
    console.log('❌ Advanced configuration cancelled.');
  }
}

async function showCurrentConfiguration(settings: any) {
  console.log('\n📋 Current Garbage Cleanup Configuration:');
  console.log('==========================================');
  
  const gc = settings.garbageCleanup;
  console.log(`Enabled: ${gc.enabled ? '✅ YES' : '❌ NO'}`);
  console.log(`Confidence Threshold: ${gc.confidenceThreshold}%`);
  console.log(`Max Emails to Analyze: ${gc.maxEmailsToAnalyze}`);
  console.log(`Only Delete Older Than: ${gc.onlyDeleteOlderThanDays} days`);
  console.log(`Require Multiple Indicators: ${gc.requireMultipleIndicators ? 'YES' : 'NO'}`);
  console.log(`Safety Mode: ${gc.safetyMode}`);
  console.log(`Dry Run Mode: ${gc.dryRunMode ? '✅ YES (safe)' : '❌ NO (dangerous)'}`);
  console.log(`Backup Before Delete: ${gc.backupBeforeDelete ? 'YES' : 'NO'}`);
  console.log(`Schedule Cleanup: ${gc.scheduleCleanup ? 'YES' : 'NO'}`);
  console.log(`Cleanup Interval: ${gc.cleanupIntervalHours} hours`);
  
  console.log('\n💡 Tips:');
  console.log('• Always test with dry run mode first');
  console.log('• Use ultra-conservative safety mode for maximum protection');
  console.log('• Set a high confidence threshold (85%+) to avoid false positives');
  console.log('• Enable backups before delete for safety');
}

// Run the configuration utility
main().catch(console.error);

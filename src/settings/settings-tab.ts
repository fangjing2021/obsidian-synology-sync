// src/settings/settings-tab.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type SynologySyncPlugin from '../main';

export class SynologySyncSettingTab extends PluginSettingTab {
  plugin: SynologySyncPlugin;

  constructor(app: App, plugin: SynologySyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Synology QuickSync Settings' });

    new Setting(containerEl)
      .setName('QuickConnect ID')
      .setDesc('Your Synology QuickConnect ID (for external/WAN sync).')
      .addText(text => text
        .setPlaceholder('e.g. my-nas')
        .setValue(this.plugin.settings.quickConnectId)
        .onChange(async (value) => {
          this.plugin.settings.quickConnectId = value.trim();
          this.plugin.resetActiveSession();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('LAN Address (Optional / 局域网地址)')
      .setDesc('Local network address (e.g. http://192.168.1.100:5000). Highly recommended for fast, direct Gigabit sync.')
      .addText(text => text
        .setPlaceholder('http://192.168.1.100:5000')
        .setValue(this.plugin.settings.lanAddress)
        .onChange(async (value) => {
          this.plugin.settings.lanAddress = value.trim();
          this.plugin.resetActiveSession();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('DSM Account')
      .setDesc('Synology DSM username.')
      .addText(text => text
        .setPlaceholder('admin')
        .setValue(this.plugin.settings.account)
        .onChange(async (value) => {
          this.plugin.settings.account = value.trim();
          this.plugin.resetActiveSession();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('DSM Password')
      .setDesc('Password is stored locally on this device in data.json (plain text). 密码仅存储于本设备配置文件中。')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('••••••••')
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            this.plugin.resetActiveSession();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Remote Vault Path')
      .setDesc('Target directory path on Synology NAS.')
      .addText(text => text
        .setPlaceholder('/homes/username/ObsidianVault')
        .setValue(this.plugin.settings.remotePath)
        .onChange(async (value) => {
          this.plugin.settings.remotePath = value.trim();
          this.plugin.resetActiveSession();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Test network reachability and authentication with your NAS.')
      .addButton(btn => btn
        .setButtonText('Test Connection')
        .setCta()
        .onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Testing...');
          try {
            await this.plugin.testConnection();
            new Notice('✓ Successfully connected to Synology NAS!');
          } catch (e: any) {
            new Notice(`✗ Connection failed: ${e.message || e}`);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText('Test Connection');
          }
        }));

    containerEl.createEl('h3', { text: 'Sync Options' });

    new Setting(containerEl)
      .setName('Auto-sync on Startup')
      .setDesc('Automatically synchronize files when Obsidian opens.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSyncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.autoSyncOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Periodic Sync Interval')
      .setDesc('Automatically synchronize at specified intervals.')
      .addDropdown(dropdown => dropdown
        .addOption('0', 'Disabled')
        .addOption('5', 'Every 5 minutes')
        .addOption('15', 'Every 15 minutes')
        .addOption('30', 'Every 30 minutes')
        .setValue(String(this.plugin.settings.syncIntervalMinutes || 0))
        .onChange(async (value) => {
          this.plugin.settings.syncIntervalMinutes = parseInt(value, 10);
          await this.plugin.saveSettings();
          this.plugin.setupSyncInterval();
        }));

    new Setting(containerEl)
      .setName('Ignore Patterns')
      .setDesc('Paths or wildcard patterns to ignore during sync (one pattern per line). Supported: *.tmp, folder/**, ._*')
      .addTextArea(text => {
        text.inputEl.rows = 6;
        text.inputEl.cols = 40;
        text
          .setPlaceholder('.obsidian/**\n.git/**\n*.tmp\n.DS_Store')
          .setValue((this.plugin.settings.ignorePatterns || []).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.ignorePatterns = value
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0);
            await this.plugin.saveSettings();
          });
      });
  }
}

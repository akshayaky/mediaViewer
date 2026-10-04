import { LocalFile } from '../types/media';

export interface LaunchResult {
  success: boolean;
  message: string;
}

export class LocalLauncherService {
  /**
   * Launches a local video file or game executable using the OS system default launcher.
   */
  public async launchFile(file: LocalFile): Promise<LaunchResult> {
    const launchTarget = file.launch_info || file.path;

    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { openPath } = await import('@tauri-apps/plugin-opener');
        await openPath(launchTarget);
        return {
          success: true,
          message: `Launched ${file.filename} with OS system default handler.`
        };
      } else {
        console.log(`[OS Opener System Call] Opening local file: ${launchTarget}`);
        alert(`[System Playback / Launcher] Executing OS default handler for:\n${launchTarget}`);
        return {
          success: true,
          message: `Simulated system launch for ${file.filename}`
        };
      }
    } catch (err: any) {
      console.error('Failed to launch file:', err);
      return {
        success: false,
        message: `Error launching file: ${err.message || String(err)}`
      };
    }
  }
}

export const localLauncherService = new LocalLauncherService();

using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Collections.Generic;

namespace WinHelper {
    public class Program {
        public static void Main(string[] args) {
            if (args.Length == 0) return;
            string command = args[0].ToLower();
            if (command == "toggle-dnd") {
                ToggleDnd();
            } else if (command == "mute" || command == "unmute") {
                if (args.Length > 1) {
                    bool mute = (command == "mute");
                    string[] apps = args[1].Split(',');
                    SetVolume(apps, mute);
                }
            }
        }

        // --- DND Toggle ---
        [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
        [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT lpPoint);
        public struct POINT { public int X; public int Y; }

        static void ToggleDnd() {
            POINT oldPos;
            GetCursorPos(out oldPos);

            // Win+N
            keybd_event(0x5B, 0, 0, UIntPtr.Zero);
            keybd_event(0x4E, 0, 0, UIntPtr.Zero);
            keybd_event(0x4E, 0, 2, UIntPtr.Zero); // KEYEVENTF_KEYUP
            keybd_event(0x5B, 0, 2, UIntPtr.Zero);
            System.Threading.Thread.Sleep(600);

            // Click at (1788, 32)
            SetCursorPos(1788, 32);
            System.Threading.Thread.Sleep(80);
            mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); // MOUSEEVENTF_LEFTDOWN
            System.Threading.Thread.Sleep(30);
            mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); // MOUSEEVENTF_LEFTUP
            System.Threading.Thread.Sleep(300);

            // Escape
            keybd_event(0x1B, 0, 0, UIntPtr.Zero);
            keybd_event(0x1B, 0, 2, UIntPtr.Zero);
            System.Threading.Thread.Sleep(100);

            SetCursorPos(oldPos.X, oldPos.Y);
        }

        // --- Audio Mute ---
        static void SetVolume(string[] appNames, bool mute) {
            var deviceEnumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
            var deviceEnumerator = (IMMDeviceEnumerator)Activator.CreateInstance(deviceEnumeratorType);
            IMMDevice defaultDevice;
            deviceEnumerator.GetDefaultAudioEndpoint(0, 1, out defaultDevice);

            IAudioSessionManager2 sessionManager;
            Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
            defaultDevice.Activate(ref IID_IAudioSessionManager2, 1, IntPtr.Zero, out sessionManager);

            IAudioSessionEnumerator sessionEnumerator;
            sessionManager.GetSessionEnumerator(out sessionEnumerator);

            int sessionCount;
            sessionEnumerator.GetCount(out sessionCount);

            HashSet<string> targetApps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var app in appNames) targetApps.Add(app.Trim());

            for (int i = 0; i < sessionCount; i++) {
                IAudioSessionControl sessionControl;
                sessionEnumerator.GetSession(i, out sessionControl);
                IAudioSessionControl2 sessionControl2 = sessionControl as IAudioSessionControl2;
                if (sessionControl2 != null) {
                    uint processId;
                    sessionControl2.GetProcessId(out processId);
                    if (processId != 0) {
                        try {
                            var process = Process.GetProcessById((int)processId);
                            if (targetApps.Contains(process.ProcessName)) {
                                ISimpleAudioVolume volume = sessionControl as ISimpleAudioVolume;
                                if (volume != null) {
                                    volume.SetMute(mute, Guid.Empty);
                                }
                            }
                        } catch { }
                    }
                }
            }
        }

        // COM Interfaces
        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator {
            int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        }
        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice {
            int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioSessionManager2 ppInterface);
        }
        [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionManager2 {
            int GetAudioSessionControl(ref Guid AudioSessionGuid, int StreamFlags, out IAudioSessionControl SessionControl);
            int GetSimpleAudioVolume(ref Guid AudioSessionGuid, int StreamFlags, out ISimpleAudioVolume AudioVolume);
            int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
        }
        [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionEnumerator {
            int GetCount(out int SessionCount);
            int GetSession(int SessionCount, out IAudioSessionControl Session);
        }
        [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl {
            int GetState(out int pRetVal);
            int GetDisplayName(out IntPtr pRetVal);
            int SetDisplayName(string Value, Guid EventContext);
        }
        [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl2 : IAudioSessionControl {
            new int GetState(out int pRetVal);
            new int GetDisplayName(out IntPtr pRetVal);
            new int SetDisplayName(string Value, Guid EventContext);
            int GetSessionIdentifier(out IntPtr pRetVal);
            int GetSessionInstanceIdentifier(out IntPtr pRetVal);
            int GetProcessId(out uint pRetVal);
            int IsSystemSoundsSession();
            int SetDuckingPreference(bool optOut);
        }
        [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface ISimpleAudioVolume {
            int SetMasterVolume(float fLevel, Guid EventContext);
            int GetMasterVolume(out float pfLevel);
            int SetMute(bool bMute, Guid EventContext);
            int GetMute(out bool pbMute);
        }
    }
}

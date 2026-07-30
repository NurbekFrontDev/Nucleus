$code = @"
using System;
using System.Runtime.InteropServices;

public class DndTest {
    [DllImport("ntdll.dll")]
    public static extern int NtUpdateWnfStateData(ref ulong StateName, byte[] Buffer, int Length, IntPtr TypeId, IntPtr ExplicitScope, int MatchingTargetState, int CheckStamp);

    public static void SetDnd(byte profile) {
        // WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0xd83063ea3bf1c75
        ulong stateName = 0xd83063ea3bf1c75;
        byte[] data = new byte[] { profile, 0, 0, 0 }; // 0 = Off, 1 = Priority Only, 2 = Alarms Only
        NtUpdateWnfStateData(ref stateName, data, data.Length, IntPtr.Zero, IntPtr.Zero, 0, 0);
    }
}
"@

Add-Type -TypeDefinition $code

Write-Host "--- Тест режима 'Не беспокоить' (DND) ---" -ForegroundColor Cyan
Write-Host "0: Выключить"
Write-Host "1: Приоритетные (Priority Only) - Стандартный DND"
Write-Host "2: Только будильники (Alarms Only) - Строгий DND"
Write-Host ""
$choice = Read-Host "Введите цифру (0, 1 или 2)"

if ($choice -match '^[012]$') {
    [DndTest]::SetDnd([byte]$choice)
    Write-Host "Команда отправлена системе! Проверьте значок на панели задач." -ForegroundColor Green
} else {
    Write-Host "Неверный ввод. Пожалуйста, введите 0, 1 или 2." -ForegroundColor Red
}

Write-Host "`nНажмите любую клавишу для выхода..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

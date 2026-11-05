/// <reference types="vite/client" />

/* File System Access API e File Handling API: non ancora in lib.dom. */
interface FilePickerType {
  description?: string;
  accept: Record<string, `.${string}`[]>;
}
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}
interface FileSystemHandle {
  queryPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface LaunchParams {
  files: FileSystemHandle[];
}
interface Window {
  showOpenFilePicker(o?: { types?: FilePickerType[]; multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(o?: { suggestedName?: string; types?: FilePickerType[] }): Promise<FileSystemFileHandle>;
  launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void };
}

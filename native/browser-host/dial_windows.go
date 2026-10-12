//go:build windows
package main
import("io";"os";"syscall";"time")
// Overlapped I/O permits a pending read and write on the same named pipe.
// Go 1.26 detects this flag in os.NewFile and enables the runtime poller.
func dial(endpoint string)(io.ReadWriteCloser,error){
 p,err:=syscall.UTF16PtrFromString(endpoint);if err!=nil{return nil,err}
 for i:=0;i<20;i++{h,e:=syscall.CreateFile(p,syscall.GENERIC_READ|syscall.GENERIC_WRITE,0,nil,syscall.OPEN_EXISTING,syscall.FILE_FLAG_OVERLAPPED,0);if e==nil{return os.NewFile(uintptr(h),endpoint),nil};err=e;time.Sleep(100*time.Millisecond)}
 return nil,err
}

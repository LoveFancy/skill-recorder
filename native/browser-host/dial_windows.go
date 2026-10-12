//go:build windows
package main
import("io";"os";"syscall";"time")
func dial(endpoint string)(io.ReadWriteCloser,error){
 p,err:=syscall.UTF16PtrFromString(endpoint);if err!=nil{return nil,err}
 for i:=0;i<20;i++{h,e:=syscall.CreateFile(p,syscall.GENERIC_READ|syscall.GENERIC_WRITE,0,nil,syscall.OPEN_EXISTING,0,0);if e==nil{return os.NewFile(uintptr(h),endpoint),nil};err=e;time.Sleep(100*time.Millisecond)}
 return nil,err
}

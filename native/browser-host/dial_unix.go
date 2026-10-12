//go:build !windows
package main
import("io";"net")
func dial(endpoint string)(io.ReadWriteCloser,error){return net.Dial("unix",endpoint)}

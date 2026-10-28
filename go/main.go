package main

import (
	"log"
	"net/http"
	"os"

	"github.com/fastlink/fastlink/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	upstream := os.Getenv("FASTLINK_UPSTREAM")
	cfg := server.Config{
		UpstreamOrigin:   upstream,
		EnableProxy:      upstream != "",
		AutoInjectClient: true,
		ScriptSrc:        "/fastlink.min.js",
	}

	srv, err := server.NewServer(cfg)
	if err != nil {
		log.Fatalf("Fatal: failed to initialize FastLink server: %v", err)
	}

	log.Printf("FastLink Go microservice listening on http://0.0.0.0:%s", port)
	if upstream != "" {
		log.Printf("Proxying and stream-rewriting upstream: %s", upstream)
	}

	if err := http.ListenAndServe(":"+port, srv); err != nil {
		log.Fatalf("Server exited: %v", err)
	}
}

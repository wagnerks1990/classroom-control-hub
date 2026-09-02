# Temporary Source Archive

This directory exists only during the initial public GitHub migration of Classroom Control Hub.

Several larger sanitized source files were staged through the GitHub API in compressed form before their direct-source counterparts could be committed. These archives are **not** the intended long-term project layout and should not be edited as the authoritative source.

Current archive naming maps to intended source paths, for example:

```text
public-display-index.html.gz          -> public/display/index.html
public-controller-veyon.html.gz       -> public/controller/veyon.html
public-controller-display.html.gz     -> public/controller/display.html
public-controller-lab.html.gz         -> public/controller/lab.html
maintenance-agent-storage.js.gz       -> maintenance-agent/storage.js
maintenance-agent-server.js.gz.b64    -> maintenance-agent/server.js
```

`.gz.b64` means the file contains Base64 text representing a gzip payload.

## Migration completion criteria

This directory can be removed after all required sanitized files are present directly at their normal runtime paths, including the main backend, storage layer, controller UI, display renderer, and maintenance service, and after repository validation succeeds against those direct files.

Do not build a production deployment from these archive files unless an explicit migration/bootstrap process documents how they are materialized. The direct source tree remains the target state.

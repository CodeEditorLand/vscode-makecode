import * as vscode from "vscode";

let extensionContext: vscode.ExtensionContext;
const assetUrl = "http://localhost:3232/asseteditor.html";
// const assetUrl = "https://arcade.makecode.com/beta--asseteditor";

export class AssetEditor {
    public static readonly viewType = "mkcdasset";
    public static currentSimulator: AssetEditor | undefined;
    public simStateTimer: any;

    public static createOrShow() {
        let column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        column = column! < 9 ? column! + 1 : column;

        if (AssetEditor.currentSimulator) {
            AssetEditor.currentSimulator.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(AssetEditor.viewType, "Microsoft MakeCode Asset Editor", {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
        });

        AssetEditor.currentSimulator = new AssetEditor(panel)
    }

    public static register(context: vscode.ExtensionContext) {
        extensionContext = context;
        vscode.window.registerWebviewPanelSerializer('mkcdasset', new AssetEditorSerializer());
    }

    public static revive(panel: vscode.WebviewPanel) {
        AssetEditor.currentSimulator = new AssetEditor(panel)
    }

    protected panel: vscode.WebviewPanel;
    protected editing: AssetEditorState | undefined;
    protected disposables: vscode.Disposable[];
    protected pendingMessages: {[index: string]: (res: any) => void} = {};
    protected nextId = 0;

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.panel.webview.onDidReceiveMessage(message => {
            this.handleSimulatorMessage(message);
        });

        this.panel.onDidDispose(() => {
            if (AssetEditor.currentSimulator === this) {
                AssetEditor.currentSimulator = undefined;
            }

            this.disposables.forEach(d => d.dispose());
        });

        this.disposables = [];
    }

    async openURIAsync(uri: vscode.Uri) {
        const parts = uri.path.split(".");
        const assetType = parts[1];
        const assetId = parts.slice(2).join(".");

        await this.openAssetAsync(assetType, assetId);
    }

    async openAssetAsync(assetType: string, assetId: string) {
        this.editing = {
            editing: {
                assetType,
                assetId
            }
        };
        this.panel.webview.html = ""
        const simulatorHTML = await getAssetEditorHtmlAsync(this.panel.webview);
        this.panel.webview.html = simulatorHTML;
    }

    handleSimulatorMessage(message: any) {
        if (this.pendingMessages[message.id]) {
            this.pendingMessages[message.id](message);
            delete this.pendingMessages[message.id];
            return;
        }

        switch (message.type) {
            case "event":
                this.handleSimulatorEventAsync(message);
                break;
        }
    }

    async handleSimulatorEventAsync(message: any) {
        const { assetType, assetId } = this.editing!.editing

        switch (message.kind) {
            case "ready":
                this.sendMessageAsync({
                    type: "open",
                    assetType,
                    assetId,
                    files: await readProjectJResAsync()
                });
                break;
        }
    }

    sendMessageAsync(message: any) {
        message._fromVscode = true;
        message.id = this.nextId++;

        return new Promise(resolve => {
            this.pendingMessages[message.id] = resolve;
            this.panel.webview.postMessage(message);
        })
    }

    addDisposable(d: vscode.Disposable) {
        this.disposables.push(d);
    }
}

interface AssetEditorState {
    editing: { assetType: string, assetId: string };
}

export class AssetEditorSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: AssetEditorState) {
        AssetEditor.revive(webviewPanel);
        await AssetEditor.currentSimulator?.openAssetAsync(state.editing.assetType, state.editing.assetId)
    }
}


async function getAssetEditorHtmlAsync(webview: vscode.Webview) {
    const uri = vscode.Uri.joinPath(extensionContext.extensionUri, "resources", "assetframe.html");
    const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));

    const pathURL = (s: string) =>
        webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, "resources", s)).toString();

    return contents
        .replace(/@RES@\/([\w\-\.]+)/g, (f, fn) => pathURL(fn))
        .replace("@ASSETURL@", assetUrl);
}

async function readProjectJResAsync() {
    const files = await vscode.workspace.findFiles("**/*.jres");
    const fileSystem: {[index: string]: string} = {};

    for (const file of files) {
        const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
        fileSystem[vscode.workspace.asRelativePath(file)] = contents;

        const pathParts = file.path.split(".");
        const tsFile = file.with({
            path: pathParts.slice(0, pathParts.length - 1).join(".") + ".ts"
        });

        try {
            const tsContents = new TextDecoder().decode(await vscode.workspace.fs.readFile(tsFile));
            fileSystem[vscode.workspace.asRelativePath(tsFile)] = tsContents;
        }
        catch (e) {
            // file does not exist
        }

        const gtsFile = file.with({
            path: pathParts.slice(0, pathParts.length - 1).join(".") + ".ts"
        });

        try {
            const gtsContents = new TextDecoder().decode(await vscode.workspace.fs.readFile(gtsFile));
            fileSystem[vscode.workspace.asRelativePath(gtsFile)] = gtsContents;
        }
        catch (e) {
            // file does not exist
        }
    }

    return fileSystem;
}
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

#if !UNITY_WEBGL || UNITY_EDITOR
using NativeWebSocket;
#endif

public class BackendConnector : MonoBehaviour
{
    [SerializeField] private string serverUrl = "wss://api.prologuebymetama.com/ws";
    [SerializeField] private bool verboseLogs = true;

#if !UNITY_WEBGL || UNITY_EDITOR
    private WebSocket ws;
#endif
    private bool connected;
    private string sessionCode = "";

    public event Action OnConnected;
    public event Action<string> OnDisconnected;
    public event Action<string> OnUnityCreated;
    public event Action<FacechinkoPlayerMsg> OnPlayerChanged;
    public event Action<FacechinkoGameResultMsg> OnGameResult;

    [Serializable] public class UnityCreateMsg { public string type = "unityCreate"; public string gameType; public string location; public int teamCount; public int allowedNumberOfPlayers; public string requestedCode; }
    [Serializable] public class UnityEnvelope { public string type = "unityMsg"; public string code; public object payload; }
    [Serializable] public class TypeOnly { public string type; }
    [Serializable] public class UnityCreated { public string type; public bool ok; public string code; public string reason; }
    [Serializable] public class FacechinkoPlayerMsg { public string type; public FacechinkoPlayer player; }
    [Serializable] public class FacechinkoPlayer { public string uid; public string name; public int teamIndex; }
    [Serializable] public class FacechinkoGameResultMsg { public string type; public int winningTeamIndex; public string mvpName; }

    public void SetServerUrl(string url) => serverUrl = url;
    public string GetSessionCode() => sessionCode;

    public void Connect()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        ws = new WebSocket(serverUrl);
        ws.OnOpen += () => { connected = true; OnConnected?.Invoke(); };
        ws.OnClose += (e) => { connected = false; OnDisconnected?.Invoke($"closed_{e}"); };
        ws.OnError += (e) => { connected = false; OnDisconnected?.Invoke(e); };
        ws.OnMessage += (bytes) => HandleInbound(System.Text.Encoding.UTF8.GetString(bytes));
        ws.Connect();
#endif
    }

    public async void Disconnect()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        if (ws != null) await ws.Close();
#endif
    }

    public void SendUnityCreate(UnityCreateMsg msg) => SendJson(msg);

    public void SendPhase(string phase)
    {
        SendUnityMsg(new Dictionary<string, object> { { "kind", "phase" }, { "phase", phase } });
    }

    public void SendGameOver(int winningTeamIndex, string mvpUid)
    {
        SendUnityMsg(new Dictionary<string, object> {
            { "kind", "gameOver" },
            { "winningTeamIndex", winningTeamIndex },
            { "mvpUid", mvpUid }
        });
    }

    public void SendUnityMsg(object payload)
    {
        SendJson(new UnityEnvelope { type = "unityMsg", code = sessionCode, payload = payload });
    }

    private async void SendJson(object obj)
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        if (!connected || ws == null) return;
        var json = JsonConvert.SerializeObject(obj);
        if (verboseLogs) Debug.Log($"[Facechinko] >> {json}");
        await ws.SendText(json);
#endif
    }

    private void HandleInbound(string json)
    {
        if (verboseLogs) Debug.Log($"[Facechinko] << {json}");
        var type = JsonConvert.DeserializeObject<TypeOnly>(json);
        if (type == null) return;

        if (type.type == "unityCreated")
        {
            var created = JsonConvert.DeserializeObject<UnityCreated>(json);
            if (created != null && created.ok)
            {
                sessionCode = created.code;
                OnUnityCreated?.Invoke(sessionCode);
            }
            return;
        }

        if (type.type == "playerRegistered" || type.type == "playerJoined" || type.type == "playerResumed")
        {
            var msg = JsonConvert.DeserializeObject<FacechinkoPlayerMsg>(json);
            if (msg != null) OnPlayerChanged?.Invoke(msg);
            return;
        }

        if (type.type == "gameResult")
        {
            var result = JsonConvert.DeserializeObject<FacechinkoGameResultMsg>(json);
            if (result != null) OnGameResult?.Invoke(result);
            return;
        }
    }

    private void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        ws?.DispatchMessageQueue();
#endif
    }

    private void OnApplicationQuit() => Disconnect();
}

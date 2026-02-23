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

    // Optional (useful if you want Unity to react when backend pauses/ends)
    public event Action<string> OnPaused;
    public event Action OnEnded;

    [Serializable]
    public class UnityCreateMsg
    {
        public string type = "unityCreate";
        public string gameType;
        public string location;
        public int teamCount;
        public int allowedNumberOfPlayers;
        public string requestedCode;
    }

    [Serializable]
    public class UnityEnvelope
    {
        public string type = "unityMsg";
        public string code;
        public object payload;
    }

    [Serializable]
    public class TypeOnly
    {
        public string type;
    }

    [Serializable]
    public class UnityCreated
    {
        public string type;
        public bool ok;
        public string code;
        public string reason;
        public object snapshot; // backend may include snapshot
        public bool reattached; // optional
    }

    [Serializable]
    public class FacechinkoPlayerMsg
    {
        public string type;
        public FacechinkoPlayer player;
        public object snapshot; // backend may include snapshot
    }

    [Serializable]
    public class FacechinkoPlayer
    {
        public string uid;
        public string name;
        public int teamIndex;
    }

    [Serializable]
    public class FacechinkoGameResultMsg
    {
        public string type;
        public int winningTeamIndex;
        public int winningTeamId; // optional
        public string mvpName;
    }

    [Serializable]
    public class PausedMsg
    {
        public string type;
        public string reason;
    }

    [Serializable]
    public class EndedMsg
    {
        public string type;
        public string reason;
    }

    public void SetServerUrl(string url) => serverUrl = url;
    public string GetSessionCode() => sessionCode;

    public void Connect()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        if (ws != null)
        {
            try { ws.Close(); } catch { }
            ws = null;
        }

        ws = new WebSocket(serverUrl);

        ws.OnOpen += () =>
        {
            connected = true;
            if (verboseLogs) Debug.Log($"[Facechinko] Connected: {serverUrl}");
            OnConnected?.Invoke();
        };

        ws.OnClose += (e) =>
        {
            connected = false;
            var msg = $"closed_{e}";
            if (verboseLogs) Debug.LogWarning($"[Facechinko] Disconnected: {msg}");
            OnDisconnected?.Invoke(msg);
        };

        ws.OnError += (e) =>
        {
            connected = false;
            if (verboseLogs) Debug.LogError($"[Facechinko] WS Error: {e}");
            OnDisconnected?.Invoke(e);
        };

        ws.OnMessage += (bytes) =>
        {
            var json = System.Text.Encoding.UTF8.GetString(bytes);
            HandleInbound(json);
        };

        ws.Connect();
#endif
    }

    public async void Disconnect()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        try
        {
            if (ws != null) await ws.Close();
        }
        catch { }
#endif
    }

    public void SendUnityCreate(UnityCreateMsg msg) => SendJson(msg);

    public void SendPhase(string phase)
    {
        SendUnityMsg(new Dictionary<string, object>
        {
            { "kind", "phase" },
            { "phase", phase }
        });
    }

    public void SendGameOver(int winningTeamIndex, string mvpUid)
    {
        SendUnityMsg(new Dictionary<string, object>
        {
            { "kind", "gameOver" },
            { "winningTeamIndex", winningTeamIndex },
            { "mvpUid", mvpUid }
        });
    }

    public void SendUnityMsg(object payload)
    {
        if (string.IsNullOrWhiteSpace(sessionCode))
        {
            if (verboseLogs) Debug.LogWarning("[Facechinko] Tried to SendUnityMsg before sessionCode was set.");
            return;
        }

        SendJson(new UnityEnvelope { type = "unityMsg", code = sessionCode, payload = payload });
    }

    private async void SendJson(object obj)
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        if (!connected || ws == null) return;

        string json;
        try
        {
            json = JsonConvert.SerializeObject(obj);
        }
        catch (Exception e)
        {
            Debug.LogError($"[Facechinko] Serialize failed: {e.Message}");
            return;
        }

        if (verboseLogs) Debug.Log($"[Facechinko] >> {json}");

        try
        {
            await ws.SendText(json);
        }
        catch (Exception e)
        {
            connected = false;
            Debug.LogError($"[Facechinko] SendText failed: {e.Message}");
            OnDisconnected?.Invoke(e.Message);
        }
#endif
    }

    private void HandleInbound(string json)
    {
        if (verboseLogs) Debug.Log($"[Facechinko] << {json}");

        TypeOnly type;
        try
        {
            type = JsonConvert.DeserializeObject<TypeOnly>(json);
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[Facechinko] Could not parse message type. Error: {e.Message}");
            return;
        }

        if (type == null || string.IsNullOrWhiteSpace(type.type))
            return;

        if (type.type == "unityCreated")
        {
            UnityCreated created = null;
            try { created = JsonConvert.DeserializeObject<UnityCreated>(json); }
            catch { }

            if (created != null && created.ok)
            {
                sessionCode = created.code;
                OnUnityCreated?.Invoke(sessionCode);
            }
            else
            {
                var reason = created != null ? created.reason : "unknown_unityCreated_failure";
                Debug.LogError($"[Facechinko] unityCreated failed: {reason}");
                OnDisconnected?.Invoke($"unityCreated_failed_{reason}");
            }
            return;
        }

        if (type.type == "playerRegistered" || type.type == "playerJoined" || type.type == "playerResumed")
        {
            FacechinkoPlayerMsg msg = null;
            try { msg = JsonConvert.DeserializeObject<FacechinkoPlayerMsg>(json); }
            catch { }

            if (msg != null) OnPlayerChanged?.Invoke(msg);
            return;
        }

        if (type.type == "gameResult")
        {
            FacechinkoGameResultMsg result = null;
            try { result = JsonConvert.DeserializeObject<FacechinkoGameResultMsg>(json); }
            catch { }

            if (result != null) OnGameResult?.Invoke(result);
            return;
        }

        if (type.type == "paused")
        {
            PausedMsg paused = null;
            try { paused = JsonConvert.DeserializeObject<PausedMsg>(json); }
            catch { }

            OnPaused?.Invoke(paused != null ? (paused.reason ?? "paused") : "paused");
            return;
        }

        if (type.type == "ended")
        {
            OnEnded?.Invoke();
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
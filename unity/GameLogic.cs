using System.Collections.Generic;
using UnityEngine;

public class GameLogic : MonoBehaviour
{
    [SerializeField] private PlayerSpawner spawner;
    [SerializeField] private Transform goalMark;

    private BackendConnector backend;
    private string roomCode;
    private bool active;
    private readonly Dictionary<string, PlayerLogic> playersByUid = new();

    public void Configure(Initializer.ControlConfig cfg, BackendConnector connector, string code)
    {
        backend = connector;
        roomCode = code;
        if (spawner == null) spawner = GetComponent<PlayerSpawner>();

        backend.OnPlayerChanged += HandlePlayerChanged;
        backend.OnGameResult += HandleGameResult;
    }

    public void BeginGameplay() => active = true;

    private void HandlePlayerChanged(BackendConnector.FacechinkoPlayerMsg msg)
    {
        if (spawner == null || msg?.player == null) return;
        var logic = spawner.SpawnOrUpdate(msg.player.uid, msg.player.name, msg.player.teamIndex);
        playersByUid[msg.player.uid] = logic;
    }

    private void Update()
    {
        if (!active || goalMark == null || backend == null) return;

        foreach (var kv in playersByUid)
        {
            var p = kv.Value;
            if (p == null) continue;
            if (p.transform.position.z >= goalMark.position.z)
            {
                active = false;
                backend.SendGameOver(p.TeamIndex, p.UID);
                break;
            }
        }
    }

    private void HandleGameResult(BackendConnector.FacechinkoGameResultMsg msg)
    {
        active = false;
    }
}

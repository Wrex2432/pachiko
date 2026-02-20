using System.Collections.Generic;
using UnityEngine;

public class PlayerSpawner : MonoBehaviour
{
    [SerializeField] private GameObject playerBallPrefab;
    [SerializeField] private Transform[] spawnPoints;

    private readonly Dictionary<string, PlayerLogic> spawned = new();

    public PlayerLogic SpawnOrUpdate(string uid, string playerName, int teamIndex)
    {
        if (spawned.TryGetValue(uid, out var existing) && existing != null)
        {
            existing.Init(uid, playerName, teamIndex);
            return existing;
        }

        var point = spawnPoints.Length > 0 ? spawnPoints[spawned.Count % spawnPoints.Length] : transform;
        var go = Instantiate(playerBallPrefab, point.position, Quaternion.identity);
        var logic = go.GetComponent<PlayerLogic>();
        if (logic == null) logic = go.AddComponent<PlayerLogic>();
        logic.Init(uid, playerName, teamIndex);
        spawned[uid] = logic;
        return logic;
    }
}

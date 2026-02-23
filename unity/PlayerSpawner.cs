using System.Collections.Generic;
using UnityEngine;

public class PlayerSpawner : MonoBehaviour
{
    [Header("Prefab")]
    [SerializeField] private GameObject playerBallPrefab;

    [Header("Spawn")]
    [Tooltip("All balls will spawn here. If not set, spawner's transform is used.")]
    [SerializeField] private Transform designatedSpawnPoint;

    [Tooltip("Optional vertical offset applied to spawn position (useful if balls clip into floor).")]
    [SerializeField] private float spawnHeightOffset = 0.05f;

    [Tooltip("If true, spawned balls become children of this spawner object.")]
    [SerializeField] private bool parentSpawnedToThis = true;

    private readonly Dictionary<string, PlayerLogic> spawned = new();

    public PlayerLogic SpawnOrUpdate(string uid, string playerName, int teamIndex)
    {
        if (string.IsNullOrWhiteSpace(uid))
        {
            Debug.LogWarning("[Facechinko][PlayerSpawner] SpawnOrUpdate called with empty uid.");
            return null;
        }

        // Update existing (do NOT reposition)
        if (spawned.TryGetValue(uid, out var existing) && existing != null)
        {
            existing.Init(uid, playerName, teamIndex);
            return existing;
        }

        if (playerBallPrefab == null)
        {
            Debug.LogError("[Facechinko][PlayerSpawner] playerBallPrefab is not assigned.");
            return null;
        }

        var point = designatedSpawnPoint != null ? designatedSpawnPoint : transform;
        var pos = point.position + new Vector3(0f, spawnHeightOffset, 0f);
        var rot = point.rotation;
        var parent = parentSpawnedToThis ? transform : null;

        var go = Instantiate(playerBallPrefab, pos, rot, parent);

        var logic = go.GetComponent<PlayerLogic>();
        if (logic == null) logic = go.AddComponent<PlayerLogic>();

        logic.Init(uid, playerName, teamIndex);
        spawned[uid] = logic;

        return logic;
    }

    public void ClearAll(bool destroyObjects = true)
    {
        if (destroyObjects)
        {
            foreach (var kv in spawned)
            {
                if (kv.Value != null) Destroy(kv.Value.gameObject);
            }
        }
        spawned.Clear();
    }
}
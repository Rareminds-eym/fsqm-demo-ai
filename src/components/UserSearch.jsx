import { AlertCircle, BarChart, Calendar, ChevronDown, Database, Search, User, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import BatchEvaluationProcessor from './BatchEvaluationProcessor';

const UserSearch = ({ onUserSelect, selectedUser }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [batchUsers, setBatchUsers] = useState([]);
  const [showBatchProcessor, setShowBatchProcessor] = useState(false);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [batchComplete, setBatchComplete] = useState(false);
  const [selectedDropdownItem, setSelectedDropdownItem] = useState('GMP');
  const [showDropdown, setShowDropdown] = useState(false);

  // Debounced search function
  const searchUsers = useCallback(async (email) => {
    if (!email || email.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('level2_screen3_progress')
        .select(`
          id,
          user_id,
          email,
          case_id,
          selected_case_id,
          current_stage,
          progress_percentage,
          is_completed,
          created_at,
          updated_at,
          idea_statement,
          stage2_problem,
          stage3_technology,
          stage4_collaboration,
          stage5_creativity,
          stage6_speed_scale,
          stage7_impact,
          stage8_final_problem,
          stage8_final_technology,
          stage8_final_collaboration,
          stage8_final_creativity,
          stage8_final_speed_scale,
          stage8_final_impact,
          stage10_reflection
        `)
        .ilike('email', `%${email.trim()}%`)
        .order('updated_at', { ascending: false })
        .limit(20); // Get more results for potential batch processing

      if (error) {
        console.error('Database query failed:', error);
        throw error;
      }

      console.log(`Found ${data ? data.length : 0} users matching "${email}"`);
      setSuggestions(data || []);
      setShowSuggestions(true);
    } catch (err) {
      console.error('Error searching users:', err);
      let errorMessage = 'Failed to search users. ';
      
      if (err.code === 'PGRST301') {
        errorMessage += 'Table not found or no access permissions.';
      } else if (err.message.includes('JWT')) {
        errorMessage += 'Authentication failed. Check your Supabase credentials.';
      } else {
        errorMessage += err.message;
      }
      
      setError(errorMessage);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      searchUsers(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, searchUsers]);

  const handleUserSelect = (user) => {
    setSearchTerm(user.email);
    setShowSuggestions(false);
    onUserSelect(user);
  };

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value);
    if (e.target.value === '') {
      onUserSelect(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const getEvaluationStatusSummary = async () => {
    try {
      // Get detailed evaluation status information for better logging
      const { data, error } = await supabase
        .from('evaluation_results')
        .select('email, evaluation_status');

      if (error) {
        console.error('Error fetching evaluation status summary:', error);
        return { successEmails: [], errorEmails: [], totalEvaluated: 0 };
      }

      const successEmails = (data || []).filter(record => record.evaluation_status === 'success').map(record => record.email);
      const errorEmails = (data || []).filter(record => record.evaluation_status === 'error').map(record => record.email);

      console.log(`Evaluation Status Summary:`);
      console.log(`- ${successEmails.length} users with successful evaluations (will be skipped)`);
      console.log(`- ${errorEmails.length} users with error status (will be re-processed):`, errorEmails);

      return { successEmails, errorEmails, totalEvaluated: data?.length || 0 };
    } catch (err) {
      console.error('Error in getEvaluationStatusSummary:', err);
      return { successEmails: [], errorEmails: [], totalEvaluated: 0 };
    }
  };

  const getCompletedUserIds = async () => {
    try {
      // Query evaluation_results table to get emails that already have successful evaluations
      // Users with 'error' status should be re-processed, so only exclude 'success' status
      const { data, error } = await supabase
        .from('evaluation_results')
        .select('email')
        .eq('evaluation_status', 'success');

      if (error) {
        console.error('Error fetching completed evaluations:', error);
        return []; // Return empty array on error to avoid blocking processing
      }

      const completedEmails = (data || []).map(record => record.email);
      return completedEmails;
    } catch (err) {
      console.error('Error in getCompletedUserIds:', err);
      return []; // Return empty array on error to avoid blocking processing
    }
  };

  const loadAllUsers = async () => {
    setLoadingBatch(true);
    setError(null);
    setBatchComplete(false);

    try {
      console.log('Loading all users who need evaluation from database...');
      
      // First, get the total count of users in level2_screen3_progress
      const { count: totalUsersCount, error: countError } = await supabase
        .from('level2_screen3_progress')
        .select('*', { count: 'exact', head: true });

      if (countError) {
        console.error('Failed to get user count:', countError);
        throw new Error(countError.message);
      }

      console.log(`Total users in database: ${totalUsersCount}`);

      // Fetch all users using pagination to handle large datasets
      let allUsers = [];
      let fromIndex = 0;
      const pageSize = 1000; // Supabase default limit
      let hasMoreData = true;
      let pageCount = 0;

      while (hasMoreData) {
        pageCount++;
        console.log(`Fetching users page ${pageCount} (records ${fromIndex + 1} to ${fromIndex + pageSize})...`);
        
        const { data: usersPage, error: usersError } = await supabase
          .from('level2_screen3_progress')
          .select(`
            id,
            user_id,
            email,
            start_id,
            case_id,
            selected_case_id,
            current_stage,
            progress_percentage,
            is_completed,
            created_at,
            updated_at,
            idea_statement,
            stage2_problem,
            stage3_technology,
            stage4_collaboration,
            stage5_creativity,
            stage6_speed_scale,
            stage7_impact,
            stage8_final_problem,
            stage8_final_technology,
            stage8_final_collaboration,
            stage8_final_creativity,
            stage8_final_speed_scale,
            stage8_final_impact,
            stage10_reflection
          `)
          .range(fromIndex, fromIndex + pageSize - 1)
          .order('updated_at', { ascending: false });

        if (usersError) {
          console.error('Failed to fetch users page:', usersError);
          throw new Error(usersError.message);
        }

        if (usersPage && usersPage.length > 0) {
          allUsers = [...allUsers, ...usersPage];
          console.log(`Fetched ${usersPage.length} users in page ${pageCount}. Total so far: ${allUsers.length}`);
          
          // Check if we got fewer records than requested, meaning we're done
          if (usersPage.length < pageSize) {
            hasMoreData = false;
          } else {
            fromIndex += pageSize;
          }
        } else {
          hasMoreData = false;
        }
      }

      console.log(`Completed fetching all users: ${allUsers.length} users in ${pageCount} pages`);

      if (!allUsers || allUsers.length === 0) {
        setError('No users found in the database.');
        return;
      }

      if (totalUsersCount !== allUsers.length) {
        console.warn(`Warning: Expected ${totalUsersCount} users but fetched ${allUsers.length} users`);
      }

      console.log(`Found ${allUsers.length} total users in database`);

      // Then, get all emails from evaluation_results table with successful status only
      // Users should be excluded only if they have 'success' status in evaluation_results
      console.log('Fetching emails with successful evaluations from evaluation_results table...');
      
      // Get total count of evaluation results first
      const { count: evalCount, error: evalCountError } = await supabase
        .from('evaluation_results')
        .select('*', { count: 'exact', head: true })
        .eq('evaluation_status', 'success');

      if (evalCountError) {
        console.warn('Warning: Failed to get successful evaluation results count:', evalCountError.message);
      } else {
        console.log(`Total successful records in evaluation_results: ${evalCount}`);
      }

      // Fetch all successful evaluation results using pagination if needed
      let allSuccessfulEvaluations = [];
      let evalFromIndex = 0;
      const evalPageSize = 1000;
      let hasMoreEvalData = true;
      let evalPageCount = 0;

      while (hasMoreEvalData) {
        evalPageCount++;
        console.log(`Fetching successful evaluation results page ${evalPageCount} (records ${evalFromIndex + 1} to ${evalFromIndex + evalPageSize})...`);
        
        const { data: evalPage, error: evalError } = await supabase
          .from('evaluation_results')
          .select('email')
          .eq('evaluation_status', 'success')
          .range(evalFromIndex, evalFromIndex + evalPageSize - 1)
          .order('id', { ascending: true });

        if (evalError) {
          console.warn('Warning: Failed to fetch successful evaluation results page:', evalError.message);
          break; // Continue processing even if we can't check evaluation status
        }

        if (evalPage && evalPage.length > 0) {
          allSuccessfulEvaluations = [...allSuccessfulEvaluations, ...evalPage];
          console.log(`Fetched ${evalPage.length} successful evaluation results in page ${evalPageCount}. Total so far: ${allSuccessfulEvaluations.length}`);
          
          if (evalPage.length < evalPageSize) {
            hasMoreEvalData = false;
          } else {
            evalFromIndex += evalPageSize;
          }
        } else {
          hasMoreEvalData = false;
        }
      }

      console.log(`Completed fetching successful evaluation results: ${allSuccessfulEvaluations.length} records in ${evalPageCount} pages`);

      // Create a Set of emails with successful evaluations only
      const successfulEmails = new Set(
        allSuccessfulEvaluations.map(record => record.email.toLowerCase().trim())
      );
      console.log(`Users with successful evaluations to skip: ${successfulEmails.size}`);
      console.log('Sample of emails with successful evaluations:', Array.from(successfulEmails).slice(0, 5));

      // Filter to include:
      // 1. Users not in evaluation_results at all
      // 2. Users in evaluation_results but without 'success' status
      const usersNeedingEvaluation = allUsers.filter(user => {
        const normalizedEmail = user.email.toLowerCase().trim();
        const hasSuccessfulEvaluation = successfulEmails.has(normalizedEmail);
        
        if (hasSuccessfulEvaluation) {
          console.log(`Skipping ${user.email} - already has successful evaluation`);
          return false;
        } else {
          console.log(`Including ${user.email} - either not in evaluation_results or has non-success status, needs evaluation`);
          return true;
        }
      });

      console.log(`Final result: ${usersNeedingEvaluation.length} users need evaluation out of ${allUsers.length} total users`);

      if (usersNeedingEvaluation.length === 0) {
        setError(`All ${allUsers.length} users in the database already have successful evaluations.`);
        return;
      }

      setBatchUsers(usersNeedingEvaluation);
      setShowBatchProcessor(true);
      setBatchComplete(false);

    } catch (err) {
      console.error('Error loading all users:', err);
      let errorMessage = 'Failed to load all users for batch processing. ';

      if (err.code === 'PGRST301') {
        errorMessage += 'Table not found or no access permissions.';
      } else if (err.message.includes('JWT')) {
        errorMessage += 'Authentication failed. Check your Supabase credentials.';
      } else {
        errorMessage += err.message;
      }

      setError(errorMessage);
    } finally {
      setLoadingBatch(false);
    }
  };

  const loadBatchUsers = async (isNextBatch = false) => {
    setLoadingBatch(true);
    setError(null);
    setBatchComplete(false);

    try {
      // Get detailed evaluation status summary for better logging
      const statusSummary = await getEvaluationStatusSummary();
      const completedEmails = await getCompletedUserIds();

      console.log(`Users to skip: ${completedEmails.length} (successful evaluations only)`);

      const DESIRED_BATCH_SIZE = 50;
      let uncompletedUsers = [];
      let currentStartId = Math.floor(currentOffset / 20) * 20 + 1; // Start from current batch position
      let searchAttempts = 0;
      const MAX_SEARCH_ATTEMPTS = 20; // Prevent infinite loops

      console.log(`Looking for ${DESIRED_BATCH_SIZE} users starting from start_id: ${currentStartId}`);

      // Keep fetching users until we have enough uncompleted ones or reach max attempts
      while (uncompletedUsers.length < DESIRED_BATCH_SIZE && searchAttempts < MAX_SEARCH_ATTEMPTS) {
        const batchStartId = currentStartId + (searchAttempts * 20);
        const batchEndId = batchStartId + 19;

        console.log(`Search attempt ${searchAttempts + 1}: Checking start_id range ${batchStartId}-${batchEndId}`);

        // Load users from current range
        const { data, error } = await supabase
          .from('level2_screen3_progress')
          .select(`
            id,
            user_id,
            email,
            start_id,
            case_id,
            selected_case_id,
            current_stage,
            progress_percentage,
            is_completed,
            created_at,
            updated_at,
            idea_statement,
            stage2_problem,
            stage3_technology,
            stage4_collaboration,
            stage5_creativity,
            stage6_speed_scale,
            stage7_impact,
            stage8_final_problem,
            stage8_final_technology,
            stage8_final_collaboration,
            stage8_final_creativity,
            stage8_final_speed_scale,
            stage8_final_impact,
            stage10_reflection
          `)
          .gte('start_id', batchStartId)
          .lte('start_id', batchEndId)
          .order('start_id', { ascending: true });

        if (error) {
          console.error('Database query failed:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          console.log(`No more users found in range ${batchStartId}-${batchEndId}, stopping search`);
          break;
        }

        // Filter out users who already have successful evaluations
        // Users with 'error' status will be included for re-processing
        const newUncompletedUsers = data.filter(user => {
          const hasSuccessfulEvaluation = completedEmails.includes(user.email);
          const hasErrorStatus = statusSummary.errorEmails.includes(user.email);

          if (hasSuccessfulEvaluation) {
            console.log(`Skipping ${user.email} - already has successful evaluation in database`);
          } else if (hasErrorStatus) {
            console.log(`Including ${user.email} - has error status, will re-process and update record`);
          } else {
            console.log(`Including ${user.email} - new user, needs first evaluation`);
          }
          return !hasSuccessfulEvaluation;
        });

        // Add new uncompleted users to our collection
        uncompletedUsers = [...uncompletedUsers, ...newUncompletedUsers];

        const newUsers = newUncompletedUsers.filter(user => !statusSummary.errorEmails.includes(user.email));
        const retryUsers = newUncompletedUsers.filter(user => statusSummary.errorEmails.includes(user.email));

        console.log(`Found ${data.length} users in range ${batchStartId}-${batchEndId}: ${newUsers.length} new + ${retryUsers.length} retry (error status). Total collected: ${uncompletedUsers.length}/${DESIRED_BATCH_SIZE}`);

        searchAttempts++;
      }

      // Take only the desired batch size
      const finalBatchUsers = uncompletedUsers.slice(0, DESIRED_BATCH_SIZE);

      console.log(`Final result: Collected ${finalBatchUsers.length} users for processing after ${searchAttempts} search attempts`);

      if (finalBatchUsers.length === 0) {
        setError(`No users available for evaluation. All users in the searched ranges already have successful evaluations. Users with error status have been included for re-processing.`);
        return;
      }

      setBatchUsers(finalBatchUsers);
      setShowBatchProcessor(true);
      setBatchComplete(false); // Reset batch completion status

      // Update offset for next batch - move forward by the number of ranges we searched
      setCurrentOffset(prev => prev + (searchAttempts * 20));

    } catch (err) {
      console.error('Error loading batch users:', err);
      let errorMessage = 'Failed to load users for batch processing. ';

      if (err.code === 'PGRST301') {
        errorMessage += 'Table not found or no access permissions.';
      } else if (err.message.includes('JWT')) {
        errorMessage += 'Authentication failed. Check your Supabase credentials.';
      } else {
        errorMessage += err.message;
      }

      setError(errorMessage);
    } finally {
      setLoadingBatch(false);
    }
  };

  const handleBatchComplete = () => {
    console.log('Batch processing completed');
    setBatchComplete(true);
  };

  const loadNextBatch = async () => {
    // Reset the batch processor state
    setBatchComplete(false);
    setShowBatchProcessor(false);

    // Load next batch of users
    await loadBatchUsers(true);
  };

  return (
    <div className="w-full max-w-4xl mx-auto mb-8">
      {/* Batch Processing Controls */}
      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Users className="h-8 w-8 text-purple-600" />
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Smart Batch Processing</h2>
              <p className="text-gray-600">Find users who need evaluation - 50 at a time or all users</p>
            </div>
          </div>

          {/* Dropdown Menu */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center space-x-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
            >
              <span>{selectedDropdownItem}</span>
              <ChevronDown className="h-4 w-4" />
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-32 bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                {['GMP', 'MC', 'FSQM'].map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setSelectedDropdownItem(item);
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors ${
                      selectedDropdownItem === item ? 'bg-purple-50 text-purple-700' : 'text-gray-700'
                    } ${item === 'GMP' ? 'rounded-t-lg' : ''} ${item === 'FSQM' ? 'rounded-b-lg' : ''}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {!showBatchProcessor && (
            <div className="flex space-x-3">
              <button
                onClick={() => loadBatchUsers(false)}
                disabled={loadingBatch}
                className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                <BarChart className="h-5 w-5" />
                <span>
                  {loadingBatch ? 'Finding Users...' : 'Find 50 Users for Evaluation'}
                </span>
              </button>
              
              <button
                onClick={loadAllUsers}
                disabled={loadingBatch}
                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                <Database className="h-5 w-5" />
                <span>
                  {loadingBatch ? 'Loading All Users...' : 'Get All Users for Evaluation'}
                </span>
              </button>
            </div>
          )}

          {showBatchProcessor && batchComplete && (
            <button
              onClick={loadNextBatch}
              disabled={loadingBatch}
              className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              <BarChart className="h-5 w-5" />
              <span>
                {loadingBatch ? 'Loading Next Users...' : 'Load Next 50 Users'}
              </span>
            </button>
          )}

          {showBatchProcessor && !batchComplete && (
            <div className="flex items-center space-x-2 bg-gray-100 text-gray-600 font-semibold py-3 px-6 rounded-lg">
              <BarChart className="h-5 w-5" />
              <span>Current Batch Processing...</span>
            </div>
          )}
        </div>
        
        {loadingBatch && (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500 mr-2"></div>
            <span className="text-gray-600">Finding users who need evaluation...</span>
          </div>
        )}
      </div>

      {/* Batch Evaluation Processor */}
      {showBatchProcessor && (
        <div className="mb-8">
          <BatchEvaluationProcessor 
            users={batchUsers} 
            onComplete={handleBatchComplete}
          />
        </div>
      )}

      {/* Individual User Search */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Search className="h-6 w-6 text-blue-600" />
          <h3 className="text-xl font-semibold text-gray-900">Individual User Search</h3>
        </div>
        
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <input
            type="email"
            value={searchTerm}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search by email address..."
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-lg"
            autoComplete="off"
          />
          {loading && (
            <div className="absolute right-3 top-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
            </div>
          )}
        </div>

        {/* Search suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-lg mt-1 shadow-lg max-h-96 overflow-y-auto">
            {suggestions.map((user) => (
              <div
                key={user.id}
                className="px-4 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                onClick={() => handleUserSelect(user)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <User className="h-5 w-5 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{user.email}</p>
                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        <span>Case ID: {user.case_id || user.selected_case_id || 'N/A'}</span>
                        <span>Stage: {user.current_stage}/10</span>
                        <span>Progress: {user.progress_percentage || 0}%</span>
                      </div>
                      {user.idea_statement && (
                        <p className="text-xs text-gray-600 mt-1 truncate max-w-md">
                          {user.idea_statement}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      user.is_completed 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {user.is_completed ? 'Completed' : 'In Progress'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No results message */}
        {showSuggestions && suggestions.length === 0 && searchTerm.length >= 2 && !loading && (
          <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-lg mt-1 shadow-lg">
            <div className="px-4 py-3 text-center text-gray-500">
              No users found with email containing "{searchTerm}"
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      {/* Selected user info */}
      {selectedUser && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-blue-900">Selected User</h3>
              <p className="text-blue-700">{selectedUser.email}</p>
              <div className="flex items-center space-x-4 text-sm text-blue-600 mt-1">
                <span>Case ID: {selectedUser.case_id || selectedUser.selected_case_id || 'N/A'}</span>
                <span>Stage: {selectedUser.current_stage}/10</span>
                <span>Progress: {selectedUser.progress_percentage || 0}%</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-sm text-blue-600">
              <Calendar className="h-4 w-4" />
              <span>Last updated: {new Date(selectedUser.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default UserSearch;
